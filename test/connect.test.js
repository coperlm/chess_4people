/**
 * 联机“加入阶段”回归测试：ICE 配置、找不到房主的反馈、计数文案修正
 * 运行: node test/connect.test.js
 */

global.document = {
  getElementById: () => null,
  createElement: () => ({ classList: { add() {}, remove() {}, contains() {} }, style: {}, appendChild() {} }),
  addEventListener() {}
};
global.window = {};
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const path = require('path');
const ROOT = path.join(__dirname, '..');
global.Config = require(path.join(ROOT, 'js/utils/Config.js'));
global.Utils = require(path.join(ROOT, 'js/utils/Utils.js'));
global.CoordinateMapper = require(path.join(ROOT, 'js/board/CoordinateMapper.js'));
global.Notation = require(path.join(ROOT, 'js/ui/Notation.js'));
const { GameState, ChessPiece } = require(path.join(ROOT, 'js/game/GameState.js'));
global.ChessPiece = ChessPiece;
global.GameState = GameState;
const PieceManager = require(path.join(ROOT, 'js/board/PieceManager.js'));
const RuleValidator = require(path.join(ROOT, 'js/game/RuleValidator.js'));
const OnlineSession = require(path.join(ROOT, 'js/net/OnlineSession.js'));

// ---- 最小 Trystero 桩：只提供 joinRoom 返回的 room 结构，并记录传入的 config ----
global.__lastCfg = null;
global.Trystero = {
  selfId: 'self',
  joinRoom(config, roomId, callbacks) {
    global.__lastCfg = config;
    global.__lastCallbacks = callbacks;
    const acts = {};
    return {
      selfId: 'peer-' + roomId + '-' + Math.random().toString(36).slice(2, 6),
      makeAction: (n) => (acts[n] = { onMessage: null, send() {} }),
      onPeerJoin: null,
      onPeerLeave: null,
      getPeers: () => ({}),
      leave: async () => {}
    };
  }
};

function fakeEngine() {
  const gs = new GameState();
  const pm = new PieceManager(gs);
  const rv = new RuleValidator(gs, pm);
  gs.ruleValidator = rv;
  pm.ruleValidator = rv;
  const br = {
    clearSelection() {}, renderPieces() {}, setNetworkMode() {}, setPlayerPosition() {},
    cancelPremove() {}, highlightLastMove() {}
  };
  return {
    gameState: gs, pieceManager: pm, ruleValidator: rv, boardRenderer: br,
    isNetworkMode: false, controlledColors: null, isGameActive: false, gameStartTime: null,
    setControlledColors(c) { this.controlledColors = c ? c.slice() : null; },
    updateUI() {}, updateMoveHistory() {}, autoSave() {}, endGame() {}, onMoveCompleted() {},
    startNewGame() { gs.reset(); gs.startGame(); this.isGameActive = true; }
  };
}

let pass = 0, fail = 0; const failures = [];
function t(name, cond, extra) { if (cond) pass++; else { fail++; failures.push(name + (extra ? '  -> ' + extra : '')); } }

(async () => {
  // ---- Config：ICE 列表 ----
  const ice = Config.iceServers();
  t('iceServers 返回非空数组', Array.isArray(ice) && ice.length > 0);
  t('iceServers 含国内 STUN（qq）', ice.some(s => String(s.urls).includes('stun.qq.com')));
  t('iceServers 含条目均为 {urls}／带 username', ice.every(s => s && s.urls));
  t('默认未配置 TURN（hasTurnServer=false）', Config.hasTurnServer() === false);
  // 运行时注入的 TURN（window.__CHESS4P_TURN__，由 tools/inject-ice.js 生成）应被合并并识别
  global.window.__CHESS4P_TURN__ = [{ urls: 'turn:relay.example:443', username: 'u', credential: 'c' }];
  t('注入的 TURN 被 iceServers() 合并', Config.iceServers().some(s => String(s.urls).includes('relay.example')));
  t('注入的 TURN 让 hasTurnServer() 为真', Config.hasTurnServer() === true);
  delete global.window.__CHESS4P_TURN__;
  t('移除注入后 hasTurnServer() 恢复为假', Config.hasTurnServer() === false);

  // ---- joinRoom 收到 rtcConfig.iceServers ----
  const host = new OnlineSession(fakeEngine());
  host._open('room1', true);
  t('joinRoom 传入 rtcConfig.iceServers', !!(global.__lastCfg && global.__lastCfg.rtcConfig && global.__lastCfg.rtcConfig.iceServers.length));
  t('房主不启动“等待房主”看门狗', host._hostWaitTimer === null);
  t('房主计数不被误判为“正在连接房主”', host._countState() !== '正在连接房主…');

  // ---- 来宾：未收到房主名册 ----
  const peer = new OnlineSession(fakeEngine());
  peer._open('room1', false);
  t('来宾每次 joinRoom 都传 rtcConfig', !!(global.__lastCfg && global.__lastCfg.rtcConfig && global.__lastCfg.rtcConfig.iceServers.length));
  t('来宾未收到名册：计数为“正在连接房主…”', peer._countState() === '正在连接房主…', peer._countState());
  t('来宾已启动看门狗', !!peer._hostWaitTimer);
  t('来宾初始 joinIssue 为空', peer._joinIssue === null);

  // ---- 来宾：收到房主名册 → 恢复正常计数、撤销看门狗 ----
  peer._onRoster({ hostId: 'h1', count: 1, started: false, seats: [{ host: true, online: true, colors: [] }] });
  t('收到名册后计数恢复（还差 1 人）', peer._countState() === '还差 1 人可开始', peer._countState());
  t('收到名册后看门狗已撤销', peer._hostWaitTimer === null);
  t('收到名册后 joinIssue 清空', peer._joinIssue === null);

  // ---- 看门狗超时（无房主）----
  const peer2 = new OnlineSession(fakeEngine());
  peer2._open('room2', false);
  peer2._onHostWaitTimeout();
  t('看门狗超时置 joinIssue=no-host', peer2._joinIssue === 'no-host');
  t('no-host 文案含“找不到房主”与房间号', /找不到房主/.test(peer2._joinIssueText() || '') && peer2._joinIssueText().includes('room2'));
  t('超时后来宾计数仍为“正在连接房主…”（由大厅提示区分文案）', peer2._countState() === '正在连接房主…');

  // ---- 建连失败回调 ----
  const peer3 = new OnlineSession(fakeEngine());
  peer3._open('room3', false);
  peer3._onJoinError({ error: 'could not connect to peer x after exchanging SDP', peerId: 'p' });
  t('onJoinError 置 joinIssue=connect-failed', peer3._joinIssue === 'connect-failed');
  t('connect-failed 文案含“无法连接到房主”', /无法连接到房主/.test(peer3._joinIssueText() || ''));
  t('已有 connect-failed 时看门狗超时不覆盖', (peer3._onHostWaitTimeout(), peer3._joinIssue === 'connect-failed'));
  // 已连上房主后，迟到的建连失败应被忽略
  peer3._onRoster({ hostId: 'h', count: 1, started: false, seats: [] });
  peer3._onJoinError({ error: 'late error' });
  t('已连上房主后忽略迟到的建连失败', peer3._joinIssue === null);
  // 房主侧的建连失败不产生用户可见问题标记
  host._onJoinError({ error: 'peer failed' });
  t('房主忽略 onJoinError', host._joinIssue === null);

  // ---- 离开：清空计时器与标记 ----
  await peer2.leave();
  t('离开后清空看门狗', peer2._hostWaitTimer === null);
  t('离开后清空 joinIssue', peer2._joinIssue === null);
  await peer3.leave();
  await peer.leave();
  await host.leave();

  console.log(`\n联机加入阶段测试: ${pass} 通过, ${fail} 失败`);
  if (fail) { console.log('失败项:'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
  console.log('✅ 全部通过');
})();
