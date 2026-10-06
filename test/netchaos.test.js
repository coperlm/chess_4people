/**
 * 联机「时序 / 掉线重连」混沌测试（虚拟时钟 + 传输层掉线钩子）
 * 运行: node test/netchaos.test.js
 *
 * 与 netstress 的分工：netstress 用真实计时器跑“随机操作”的广度；这里用**虚拟时钟**把
 * 「离线 30s 自动跳过」「房主失联 20s 接任」这类需要真实等待的时序场景瞬间步进并穷举，
 * 专门抓“时序竞态 / 掉线重连 / 接任选举”这一类最难靠手测复现的 bug。
 */
const S = require('./_sim');
const { OnlineSession, fakeEngine, makeRng, advance, settle, boardSig, sig, localInv, legalMoves, mock } = S;

let pass = 0, fail = 0; const failures = [];
function t(name, cond, extra) { if (cond) pass++; else { fail++; failures.push(name + (extra ? '  -> ' + extra : '')); } }

let roomSeq = 0;
const newRoom = () => 'chaos-' + (++roomSeq);
function newSession(ref, token, name) { const s = new OnlineSession(fakeEngine(ref || { current: null })); s.token = token; s.name = name; return s; }

/** 建房 + 握手 + 房主开局；返回 host/peers/all */
async function setupRoom(n, room, rules) {
  const hostRef = { current: null };
  const host = newSession(hostRef, 'H', 'H'); hostRef.current = host;
  host.settings = rules || { mode: 'team', victory: 'any_king', friendlyFire: false };
  host._open(room, true);
  const peers = [];
  for (let i = 1; i < n; i++) { const s = newSession(null, 'P' + i, 'P' + i); peers.push(s); s._open(room, false); }
  await settle(3);
  peers.forEach(s => s._sendHello());
  await settle(4);

  const groups = host._groupsFor(n);
  host.participants.forEach((p, i) => { p.colors = groups[i] || []; });
  host.participants.forEach((p, i) => {
    if (p.token === host.token) host._setMyColors(p.colors);
    else if (p.id) host.actAssign.send({ colors: p.colors, seat: i, hostId: host.selfId, settings: host.settings }, { target: p.id });
  });
  host.started = true;
  const gs = host.gameEngine.gameState;
  gs.reset(); gs.setRules(host.settings); gs.startGame(); host.gameEngine.isGameActive = true;
  const assigned = new Set(); host.participants.forEach(p => (p.colors || []).forEach(c => assigned.add(c)));
  for (let c = 0; c < 4; c++) if (!assigned.has(c)) gs.removeColor(c);
  host._broadcastRoster(); host._broadcastState();
  await settle(6);
  return { host, peers, all: [host, ...peers] };
}

/** 结束一批会话，清掉各自（含虚拟）定时器，避免跨场景泄漏 */
async function teardown(sessions) {
  for (const s of sessions) { try { if (s && s.active) await s.leave(); } catch (e) {} }
  await settle(2);
}

function makeMove(host, s) {
  const gs = host.gameEngine.gameState;
  if (!(s.myColors || []).includes(gs.currentPlayer)) return false;
  const mv = legalMoves(gs, host.gameEngine.ruleValidator);
  if (!mv.length) return false;
  const m = mv[0];
  s.requestMove(m[0], m[1], m[2], m[3]);
  return true;
}

(async () => {
  // ===== 1) 离线玩家：30s 到点自动跳过其回合（虚拟时钟瞬间步进）=====
  {
    const room = newRoom();
    const { host, peers, all } = await setupRoom(4, room);
    const gs = host.gameEngine.gameState;
    const p1 = host.participants.find(p => p.token === 'P1');
    const color = p1.colors[0];
    gs.currentPlayer = color; host._checkOfflineTurn(); await settle(2);

    const beforeBoard = boardSig(gs);
    mock.__drop(peers[0].selfId); await settle(4);
    t('[跳过] 掉线后席位标为离线', p1.id === null);

    await advance(29900);
    t('[跳过] 未到 30s 不跳过', gs.currentPlayer === color, 'cp=' + gs.currentPlayer);
    await advance(600);
    t('[跳过] 30s 到点跳过该回合', gs.currentPlayer !== color, 'cp=' + gs.currentPlayer);
    t('[跳过] 跳过只推进回合、不动棋盘', boardSig(gs) === beforeBoard);
    t('[跳过] 被跳过者未出局', !gs.eliminationOrder.includes(color));
    await teardown(all);
  }

  // ===== 2) 离线玩家在 30s 前重连 → 撤销跳过 =====
  {
    const room = newRoom();
    const { host, peers, all } = await setupRoom(4, room);
    const gs = host.gameEngine.gameState;
    const p1 = host.participants.find(p => p.token === 'P1');
    const color = p1.colors[0];
    gs.currentPlayer = color; host._checkOfflineTurn(); await settle(2);

    mock.__drop(peers[0].selfId); await settle(4);
    await advance(25000);
    const re = newSession(null, 'P1', 'P1');    // 同 token 重连（等价刷新页面）
    re._open(room, false); await settle(3); re._sendHello(); await settle(5);
    t('[重连] 席位恢复在线', host.participants.find(p => p.token === 'P1').id === re.selfId);
    await advance(10000);   // 累计已越过 30s
    t('[重连] 重连已撤销“自动跳过”', gs.currentPlayer === color, 'cp=' + gs.currentPlayer);
    t('[重连] 重连后局面与房主一致', sig(re) === sig(host));
    await teardown([...all, re]);
  }

  // ===== 3) 房主失联：20s 后恰好一端接任（+ 序号纪元）=====
  {
    const room = newRoom();
    const { host, peers, all } = await setupRoom(4, room);
    mock.__drop(host.selfId); await settle(6);

    t('[接任] 客户端已启动接任计时', peers.some(s => s._failoverTimer != null));
    await advance(20000); await settle(8);

    const newHosts = peers.filter(s => s.isHost);
    t('[接任] 恰好一端接任房主', newHosts.length === 1, 'hosts=' + newHosts.length);
    if (newHosts.length === 1) {
      const nh = newHosts[0];
      const others = peers.filter(s => s !== nh);
      t('[接任] 接任者序号用时间戳纪元', nh.seq > 1e12, 'seq=' + nh.seq);
      t('[接任] 接任后其余端与新房主一致', others.every(s => sig(s) === sig(nh)));

      const gs = nh.gameEngine.gameState;
      const ctrl = [nh, ...others].find(s => (s.myColors || []).includes(gs.currentPlayer));
      if (ctrl) {
        const before = gs.moveHistory.length;
        const ok = makeMove(nh, ctrl);
        await settle(6);
        t('[接任] 接任后可继续走子', ok && gs.moveHistory.length === before + 1,
          'moves ' + before + '->' + gs.moveHistory.length);
        t('[接任] 走子后其余端仍一致', others.every(s => sig(s) === sig(nh)));
      }
    }
    await teardown(all);
  }

  // ===== 4) 掉线者错过若干手后重连 → 快照补发后回合/局面追平 =====
  {
    const room = newRoom();
    const { host, peers, all } = await setupRoom(4, room);
    const gs = host.gameEngine.gameState;
    const victim = peers[0];
    mock.__drop(victim.selfId); await settle(4);

    for (let k = 0; k < 6 && gs.gamePhase === 'playing'; k++) {
      const ctrl = [host, ...peers.slice(1)].find(s => (s.myColors || []).includes(gs.currentPlayer));
      if (!ctrl || !makeMove(host, ctrl)) break;
      await settle(5);
    }

    const re = newSession(null, victim.token, victim.name);
    re._open(room, false); await settle(3); re._sendHello(); await settle(6);
    t('[追平] 重连后局面追平房主', sig(re) === sig(host));
    t('[追平] 重连后回合追平房主', re.gameEngine.gameState.currentPlayer === gs.currentPlayer);
    await teardown([...all, re]);
  }

  // ===== 5) 随机 churn 模糊：随机掉线/重连 + 随机时钟推进 =====
  {
    const rng = makeRng(20261006);
    const stats = { games: 0, plies: 0, bad: 0, samples: [] };
    for (let g = 0; g < 20; g++) {
      const room = newRoom();
      const { host, peers } = await setupRoom(4, room);
      const live = new Set([host, ...peers]);
      const created = [host, ...peers];
      const dropped = [];
      let plies = 0;
      for (let step = 0; step < 100 && host.gameEngine.gameState.gamePhase === 'playing'; step++) {
        const gs = host.gameEngine.gameState;
        const r = rng();
        if (r < 0.62) {
          const ctrl = [...live].find(s => (s.myColors || []).includes(gs.currentPlayer));
          if (ctrl && makeMove(host, ctrl)) plies++;
        } else if (r < 0.74 && [...live].some(s => s !== host)) {
          const cand = [...live].filter(s => s !== host);
          const victim = cand[Math.floor(rng() * cand.length)];
          live.delete(victim);
          dropped.push({ token: victim.token, name: victim.name });
          mock.__drop(victim.selfId);
        } else if (r < 0.84 && dropped.length) {
          const d = dropped.splice(Math.floor(rng() * dropped.length), 1)[0];
          const re = newSession(null, d.token, d.name);
          re._open(room, false); await settle(2); re._sendHello();
          live.add(re); created.push(re);
        } else if (r < 0.90) {
          await advance(30000);   // 推进到可能的“离线自动跳过”
        } else {
          await advance(500 + Math.floor(rng() * 3000));
        }
        await settle(5);

        let bad = null;
        for (const s of live) { const e = localInv(s); if (e) { bad = s.name + ':' + e; break; } }
        if (!bad) { const hs = sig(host); for (const s of live) if (s !== host && sig(s) !== hs) { bad = 'desync:' + s.name; break; } }
        if (bad) { stats.bad++; if (stats.samples.length < 3) stats.samples.push({ game: g, step, bad }); break; }
      }
      stats.games++; stats.plies += plies;
      await teardown(created);
    }
    t('[churn] ' + stats.games + ' 局随机掉线重连无失步/无不变量错误', stats.bad === 0,
      stats.samples.length ? JSON.stringify(stats.samples[0]) : '');
    t('[churn] 累计走了 ' + stats.plies + ' 手', stats.plies > 0);
    console.log(`(混沌细节：churn ${stats.games} 局 / ${stats.plies} 手，含掉线·重连·30s 时钟跳进)`);
  }

  // ===== 6) 已出局者不能再影响对局（悔棋/求和被拒，且房主端也复核）=====
  {
    const room = newRoom();
    const { host, peers, all } = await setupRoom(4, room, { mode: 'ffa', victory: 'last_team', friendlyFire: false });
    const victim = peers[0];
    victim.requestResignSelf(); await settle(8);
    t('[出局] 认输后确实出局', host.gameEngine.gameState.eliminationOrder.includes(victim.myColors[0]),
      'elim=' + JSON.stringify(host.gameEngine.gameState.eliminationOrder));
    t('[出局] 该端自认已出局', victim._allEliminated() === true);
    const sent = []; victim.actIntent.send = (m) => sent.push(m);
    victim.requestUndo(); victim.requestDraw();
    t('[出局] 不能悔棋/求和（不发出请求）', sent.length === 0, JSON.stringify(sent));
    await teardown(all);
  }

  // ===== 7) 和棋票只算“仍在场”的玩家（已出局者不参与、不否决）=====
  {
    const room = newRoom();
    const { host, peers, all } = await setupRoom(4, room, { mode: 'ffa', victory: 'last_team', friendlyFire: false });
    const victim = peers[0], proposer = peers[1];
    victim.requestResignSelf(); await settle(8);
    t('[和棋票] 已出局者不参与投票', host.gameEngine.gameState.eliminationOrder.includes(victim.myColors[0]));
    proposer.requestDraw(); await settle(12);   // 提议者 + 房主 + 另一在场者也同意
    t('[和棋票] 仅在场者同意即可和棋（无需已出局者）',
      host.gameEngine.gameState.isDraw === true, 'isDraw=' + host.gameEngine.gameState.isDraw);
    await teardown(all);
  }

  console.log(`\n联机混沌测试（虚拟时钟）: ${pass} 通过, ${fail} 失败`);
  if (fail) { console.log('失败项:'); failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
  console.log('✅ 全部通过');
})();
