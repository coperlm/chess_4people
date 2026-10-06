/**
 * 真浏览器多端 E2E（免依赖，直接用系统 chromium + 原生 CDP）
 * 运行: npm run e2e    或    node test/e2e/run.js
 *
 * 起一个 headless chromium，开**互相隔离的浏览器上下文**（各自独立 localStorage → 不同身份），
 * 加载同一测试页面（test/e2e/transport.js 顶替 vendor Trystero，消息由本驱动中转，**完全离线**），
 * 跑真实联机流程：房主建房 → 客户端 ?room= 加入 → 开局 → 双方各在真实棋盘上点着走一手 →
 * 客户端掉线 → 重连追平。断言：跨端局面/回合一致、真实 DOM 渲染同步、重连后追平、无页面报错。
 * 这是对“自己开多窗口手测”的自动化替代。需要本机有 chromium（CHROME=/path 可覆盖）。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CHROME = process.env.CHROME || '/usr/bin/chromium';
const VENDOR_TAG = '<script src="vendor/trystero.nostr.iife.js"></script>';
const TEST_TAG = '<script src="test/e2e/transport.js"></script>';

let pass = 0, fail = 0; const failures = [];
const t = (name, cond, extra) => { if (cond) pass++; else { fail++; failures.push(name + (extra ? '  -> ' + extra : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.handlers = []; }
  open() { return new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; this.ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } this._on(m); }; }); }
  _on(m) {
    if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    else { for (const h of this.handlers) { try { h(m); } catch (e) {} } }
  }
  send(method, params = {}, sessionId) {
    return new Promise((res, rej) => {
      const id = ++this.id; this.pending.set(id, { res, rej });
      const msg = { id, method, params }; if (sessionId) msg.sessionId = sessionId;
      this.ws.send(JSON.stringify(msg));
    });
  }
  on(fn) { this.handlers.push(fn); }
  close() { try { this.ws.close(); } catch (e) {} }
}

const MOVE_IIFE = `(() => {
  const gs = window.gameEngine.gameState; if (gs.gamePhase !== 'playing') return 'phase';
  const cp = gs.currentPlayer;
  if (!(window.onlineSession.myColors || []).includes(cp)) return 'not-my-turn';
  const click=(x,y)=>{const c=document.getElementById('cell-'+x+'-'+y); if(c) c.dispatchEvent(new MouseEvent('click',{bubbles:true}));};
  const rv = window.gameEngine.ruleValidator;
  for (let x=0;x<10;x++) for (let y=0;y<10;y++){ const p=gs.board[x][y]; if(!p||p.player!==cp) continue;
    const mv=rv.getValidMoves(x,y); if(mv.length){ click(x,y); click(mv[0].x, mv[0].y); return 'moved:'+x+','+y+'>'+mv[0].x+','+mv[0].y; } }
  return 'no-legal';
})()`;

(async () => {
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  if (!idx.includes(VENDOR_TAG)) throw new Error('index.html 里找不到 Trystero 脚本标签（结构变了？）');
  const pagePath = path.join(ROOT, '_e2e_page.html');
  fs.writeFileSync(pagePath, idx.replace(VENDOR_TAG, TEST_TAG));
  const pageUrl = 'file://' + pagePath;

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-e2e-'));
  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1200,900', 'about:blank'
  ], { stdio: 'ignore' });

  let cdp = null;
  const pages = {};     // sessionId -> { id, rooms:Set, errors:[] }
  const rooms = {};     // roomId -> Set<sessionId>
  const cleanup = () => {
    try { if (cdp) cdp.close(); } catch (e) {}
    try { child.kill('SIGKILL'); } catch (e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    try { fs.rmSync(pagePath, { force: true }); } catch (e) {}
  };

  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    let port = null;
    for (let i = 0; i < 100 && !port; i++) { try { port = parseInt(fs.readFileSync(portFile, 'utf8').split('\n')[0], 10) || null; } catch (e) { await sleep(100); } }
    if (!port) throw new Error('chromium 未就绪（DevToolsActivePort 未出现）');
    const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    cdp = new CDP(ver.webSocketDebuggerUrl);
    await cdp.open();

    const evalOn = async (sid, expr) => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sid);
      if (r.exceptionDetails) throw new Error('页面执行异常: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
      return r.result ? r.result.value : undefined;
    };
    const waitFor = async (sid, expr, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await evalOn(sid, `!!(${expr})`)) return true; } catch (e) {} await sleep(80); } return false; };
    const callOp = (sid, expr) => { cdp.send('Runtime.evaluate', { expression: expr }, sid).catch(() => {}); };

    function handleBus(fromSid, payload) {
      let m; try { m = JSON.parse(payload); } catch (e) { return; }
      const me = pages[fromSid]; if (!me) return;
      if (m.t === 'join') {
        const members = (rooms[m.roomId] = rooms[m.roomId] || new Set());
        me.rooms.add(m.roomId);
        for (const other of members) {
          const op = pages[other]; if (!op) continue;
          callOp(other, `window.__t.peerJoin(${JSON.stringify(m.roomId)}, ${JSON.stringify(me.id)})`);
          callOp(fromSid, `window.__t.peerJoin(${JSON.stringify(m.roomId)}, ${JSON.stringify(op.id)})`);
        }
        members.add(fromSid);
      } else if (m.t === 'msg') {
        for (const other of (rooms[m.roomId] || [])) {
          if (other === fromSid) continue;
          const op = pages[other]; if (!op) continue;
          if (m.target && op.id !== m.target) continue;
          callOp(other, `window.__t.msg(${JSON.stringify(m.roomId)},${JSON.stringify(m.action)},${JSON.stringify(m.data)},${JSON.stringify(me.id)},${JSON.stringify(m.target || null)})`);
        }
      } else if (m.t === 'leave') {
        const members = rooms[m.roomId] || new Set();
        members.delete(fromSid); me.rooms.delete(m.roomId);
        for (const other of members) { if (pages[other]) callOp(other, `window.__t.peerLeave(${JSON.stringify(m.roomId)}, ${JSON.stringify(me.id)})`); }
      }
    }
    /** 页面消失（掉线）：向同房间其它页面广播 peerLeave */
    function dropPage(sid) {
      const me = pages[sid]; if (!me) return;
      for (const roomId of me.rooms) {
        (rooms[roomId] || new Set()).delete(sid);
        for (const other of (rooms[roomId] || [])) if (pages[other]) callOp(other, `window.__t.peerLeave(${JSON.stringify(roomId)}, ${JSON.stringify(me.id)})`);
      }
      delete pages[sid];
    }

    const newPage = async (browserContextId, peerId, url) => {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send('Runtime.addBinding', { name: '__cdpSend' }, sessionId);
      pages[sessionId] = { id: peerId, rooms: new Set(), errors: [] };
      cdp.on(msg => {
        if (msg.sessionId !== sessionId) return;
        if (msg.method === 'Runtime.exceptionThrown') {
          const d = msg.params.exceptionDetails || {};
          pages[sessionId] && pages[sessionId].errors.push('exception: ' + ((d.exception && (d.exception.description || d.exception.value)) || d.text));
        } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
          pages[sessionId] && pages[sessionId].errors.push('console.error: ' + (msg.params.args || []).map(a => a.value || a.description || '').join(' '));
        } else if (msg.method === 'Runtime.bindingCalled' && msg.params.name === '__cdpSend') {
          handleBus(sessionId, msg.params.payload);
        }
      });
      await cdp.send('Page.navigate', { url }, sessionId);
      return { sessionId, targetId, id: peerId };
    };
    const READY = "window.onlineSession && window.gameInterface && window.gameEngine && document.querySelectorAll('.chess-cell').length === 100";
    const snap = sid => evalOn(sid, 'window.gameEngine.gameState.moveHistory.length + "|" + window.gameEngine.gameState.currentPlayer');

    // ---- 场景 ----
    const hostCtx = (await cdp.send('Target.createBrowserContext')).browserContextId;
    const cliCtx = (await cdp.send('Target.createBrowserContext')).browserContextId;

    const host = await newPage(hostCtx, 'peer1', `${pageUrl}?_peer=peer1`);
    t('[E2E] 房主页加载应用', await waitFor(host.sessionId, READY));

    const roomId = await evalOn(host.sessionId, '(window.onlineSession._onCreate(), window.onlineSession.roomId)');
    t('[E2E] 房主创建房间', !!roomId, 'roomId=' + roomId);

    const cli = await newPage(cliCtx, 'peer2', `${pageUrl}?room=${encodeURIComponent(roomId)}&_peer=peer2`);
    t('[E2E] 客户端页加载应用', await waitFor(cli.sessionId, READY));
    t('[E2E] 客户端经 ?room= 自动加入', await waitFor(cli.sessionId, 'window.onlineSession.active === true'));
    t('[E2E] 房主看到 2 名参与者', await waitFor(host.sessionId, 'window.onlineSession.participants.length >= 2', 6000));

    await evalOn(host.sessionId, 'window.onlineSession.startMatch()');
    t('[E2E] 开局后客户端进入对局', await waitFor(cli.sessionId, 'window.onlineSession.started === true && window.gameEngine.gameState.gamePhase === "playing"', 8000));

    // 房主走一手（真实 DOM 事件）
    const hostMove = await evalOn(host.sessionId, MOVE_IIFE);
    t('[E2E] 房主在真实棋盘走出一手', String(hostMove).startsWith('moved:'), 'r=' + hostMove);
    await sleep(700);
    t('[E2E] 走子后两端局面/回合一致', (await snap(host.sessionId)) === (await snap(cli.sessionId)), `${await snap(host.sessionId)} vs ${await snap(cli.sessionId)}`);
    // 客户端“真实渲染”同步：落点格确实出现了棋子
    if (String(hostMove).startsWith('moved:')) {
      const to = String(hostMove).slice(6).split('>')[1].split(',');
      t('[E2E] 客户端 DOM 已渲染落子', await evalOn(cli.sessionId, `!!document.getElementById('cell-${to[0]}-${to[1]}').querySelector('.chess-piece')`));
    }

    // 客户端走一手（双向）
    const cliMove = await evalOn(cli.sessionId, MOVE_IIFE);
    t('[E2E] 客户端也能走一手', String(cliMove).startsWith('moved:'), 'r=' + cliMove);
    await sleep(700);
    t('[E2E] 客户端走子后两端仍一致', (await snap(host.sessionId)) === (await snap(cli.sessionId)), `${await snap(host.sessionId)} vs ${await snap(cli.sessionId)}`);

    // 客户端“掉线” → 房主看到离线
    await cdp.send('Target.closeTarget', { targetId: cli.targetId }).catch(() => {});
    dropPage(cli.sessionId);
    t('[E2E] 掉线后房主看到该席位离线', await waitFor(host.sessionId, 'window.onlineSession.participants.some(p => p.id === null)', 6000));

    // 同上下文重连（同 token → 回到原席位）→ 快照追平
    const cli2 = await newPage(cliCtx, 'peer3', `${pageUrl}?room=${encodeURIComponent(roomId)}&_peer=peer3`);
    t('[E2E] 重连页加载', await waitFor(cli2.sessionId, READY));
    t('[E2E] 重连后席位恢复在线', await waitFor(host.sessionId, 'window.onlineSession.participants.every(p => p.id !== null)', 8000));
    await sleep(500);
    t('[E2E] 重连后局面追平房主', (await snap(cli2.sessionId)) === (await snap(host.sessionId)), `${await snap(cli2.sessionId)} vs ${await snap(host.sessionId)}`);

    // ---- 房间号加入（APK 内没有可点的邀请链接，这是唯一入口，必须走真实 UI 验证）----
    const host2Ctx = (await cdp.send('Target.createBrowserContext')).browserContextId;
    const joinCtx = (await cdp.send('Target.createBrowserContext')).browserContextId;

    const host2 = await newPage(host2Ctx, 'peer4', `${pageUrl}?_peer=peer4`);
    t('[E2E] 第二房主页加载', await waitFor(host2.sessionId, READY));
    await evalOn(host2.sessionId, "document.getElementById('createRoomBtn').click()");
    const room2 = await evalOn(host2.sessionId, 'window.onlineSession.roomId');
    t('[E2E] 点「创建房间」按钮建房', !!room2, 'roomId=' + room2);
    t('[E2E] 大厅显示房间号', (await evalOn(host2.sessionId, "document.getElementById('lobbyRoomCode').textContent.trim()")) === room2);

    const joiner = await newPage(joinCtx, 'peer5', `${pageUrl}?_peer=peer5`);
    t('[E2E] 加入方页加载', await waitFor(joiner.sessionId, READY));

    // 非法房间号不该建立会话
    await evalOn(joiner.sessionId, `(() => {
      document.getElementById('joinRoomInput').value = '!!';
      document.getElementById('joinRoomBtn').click();
    })()`);
    t('[E2E] 非法房间号不加入', (await evalOn(joiner.sessionId, 'window.onlineSession.active')) === false);

    // 把房主显示的房间号填进输入框再点「加入房间」
    const clicked = await evalOn(joiner.sessionId, `(() => {
      const inp = document.getElementById('joinRoomInput');
      const btn = document.getElementById('joinRoomBtn');
      if (!inp || !btn) return 'no-ui';
      inp.value = ${JSON.stringify(room2)};
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      btn.click();
      return 'clicked';
    })()`);
    t('[E2E] 存在「加入房间」输入框与按钮', clicked === 'clicked', 'r=' + clicked);
    t('[E2E] 输入房间号后成功加入', await waitFor(joiner.sessionId, `window.onlineSession.active === true && window.onlineSession.roomId === ${JSON.stringify(room2)}`));
    t('[E2E] 房主看到该玩家进房', await waitFor(host2.sessionId, 'window.onlineSession.participants.length >= 2', 6000));

    // ---- 页面报错 ----
    const benign = /Failed to fetch|package\.json|favicon|ERR_FILE_NOT_FOUND|ServiceWorker|net::ERR_/i;
    for (const p of Object.values(pages)) {
      const real = p.errors.filter(e => !benign.test(e));
      t('[E2E] ' + p.id + ' 无页面报错', real.length === 0, real.slice(0, 3).join(' | '));
    }
  } catch (e) {
    t('[E2E] 运行异常', false, e && e.message);
  } finally {
    cleanup();
  }

  console.log(`\n真浏览器多端 E2E: ${pass} 通过, ${fail} 失败`);
  if (fail) { console.log('失败项:'); failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
  console.log('✅ 全部通过');
})();
