/**
 * 联机快照回归测试：广播快照不带 moveHistory（瘦身），但一致性不能被破坏。
 * 运行: node test/snapshot.test.js
 *
 * 背景：moveHistory 每手约 155 B、随对局线性增长；走子是逐手广播的，各端本地已累积同样历史，
 * 故常规广播无需再带（一局长棋的广播快照 24 KB → 1.4 KB）。只有“定向发给某个刚加入/重同步的
 * peer”才需要带全量历史供其补齐。本测试锁定三件事：精简广播不丢历史、定向快照能补齐、重连能追平。
 */
const sim = require('./_sim.js');
const { OnlineSession, fakeEngine, settle, legalMoves } = sim;

let pass = 0, fail = 0; const fails = [];
const t = (n, c, extra) => { if (c) pass++; else { fail++; fails.push(n + (extra ? '  -> ' + extra : '')); } };

const canon = h => JSON.stringify((h || []).map(m => ({
  p: m.player, k: m.piece, f: [m.from.x, m.from.y], t: [m.to.x, m.to.y], turn: m.turn,
  c: m.captured ? [m.captured.type, m.captured.player, m.captured.facing] : null
})));

(async () => {
  const mk = () => { const ref = { current: null }; const eng = fakeEngine(ref); const s = new OnlineSession(eng); ref.current = s; return s; };

  const host = mk();
  const peers = [mk(), mk()];
  host._open('snap', true);
  for (const p of peers) p._open('snap', false);
  await settle(10);
  host.startMatch();
  await settle(10);

  // ---- 1. _snapshot 的开关 ----
  const full = host._snapshot();
  const lite = host._snapshot({ withHistory: false });
  t('默认快照带 moveHistory', Array.isArray(full.moveHistory));
  t('withHistory=false 时不带 moveHistory', lite.moveHistory === undefined);
  t('精简快照仍带 board/currentPlayer 等关键字段', Array.isArray(lite.board) && lite.currentPlayer !== undefined && lite.gamePhase === full.gamePhase);

  // ---- 2. 走若干手 ----
  const step = async n => {
    for (let i = 0; i < n; i++) {
      const gs = host.gameEngine.gameState;
      if (gs.gamePhase !== 'playing') return;
      const s = [host, ...peers].find(x => (x.myColors || []).includes(gs.currentPlayer));
      if (!s) return;
      const mv = legalMoves(gs, host.gameEngine.ruleValidator);
      if (!mv.length) return;
      const p = mv[Math.floor(Math.random() * mv.length)];
      s.requestMove(p[0], p[1], p[2], p[3]);
      await settle(6);
    }
  };
  await step(40);
  const H = host.gameEngine.gameState.moveHistory;
  t('历史已累积（>=30 手）', H.length >= 30, 'len=' + H.length);
  // 有历史后，精简快照应显著更小（历史是快照里最大的部分）
  const full2 = JSON.stringify(host._snapshot()).length;
  const lite2 = JSON.stringify(host._snapshot({ withHistory: false })).length;
  t('有历史后精简快照显著更小（<50%）', lite2 < full2 * 0.5, lite2 + ' vs ' + full2);

  // 精简广播（含 _broadcastState：离线跳过/终局等路径）不会清空各端本地历史
  host._broadcastState();
  await settle(8);
  for (let i = 0; i < peers.length; i++) {
    t(`广播后 peer${i} 历史未被清空`, peers[i].gameEngine.gameState.moveHistory.length === H.length,
      peers[i].gameEngine.gameState.moveHistory.length + ' vs ' + H.length);
  }

  // ---- 3. 中途加入者：靠定向全量快照补齐 ----
  const late = mk();
  late._open('snap', false);
  await settle(12);
  t('中途加入者历史补全', late.gameEngine.gameState.moveHistory.length === H.length,
    late.gameEngine.gameState.moveHistory.length + ' vs ' + H.length);
  t('中途加入者历史内容与房主一致', canon(late.gameEngine.gameState.moveHistory) === canon(H));

  // ---- 4. 断线重连：同 token 重连后追平 ----
  const victim = peers[0];
  const token = victim.token, vid = victim.room.selfId;
  sim.mock.__drop(vid);
  await settle(6);
  await step(8);
  const back = mk();
  back.token = token;
  back._open('snap', false);
  await settle(14);
  const H2 = host.gameEngine.gameState.moveHistory;
  t('重连者历史追平', back.gameEngine.gameState.moveHistory.length === H2.length,
    back.gameEngine.gameState.moveHistory.length + ' vs ' + H2.length);
  t('重连者历史内容与房主一致', canon(back.gameEngine.gameState.moveHistory) === canon(H2));
  t('在线的 peer 历史内容仍与房主一致', canon(peers[1].gameEngine.gameState.moveHistory) === canon(H2));

  console.log(`\n联机快照测试: ${pass} 通过, ${fail} 失败`);
  if (fail) { console.log('失败项:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
  console.log('✅ 全部通过');
})();
