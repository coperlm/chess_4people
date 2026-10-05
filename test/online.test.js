/**
 * 联机对局协议测试（用内存版 Trystero 模拟两个浏览器，验证房主权威流程）
 * 运行: node test/online.test.js
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
const { GameState, ChessPiece } = require(path.join(ROOT, 'js/game/GameState.js'));
global.ChessPiece = ChessPiece;
global.GameState = GameState;
const PieceManager = require(path.join(ROOT, 'js/board/PieceManager.js'));
const RuleValidator = require(path.join(ROOT, 'js/game/RuleValidator.js'));
const OnlineSession = require(path.join(ROOT, 'js/net/OnlineSession.js'));

// ---- 内存版 Trystero（同进程模拟多个浏览器） ----
function MockTrystero() {
  const rooms = new Map(); // roomId -> [entry]
  let counter = 0;
  const tick = fn => setTimeout(fn, 0);
  return {
    selfId: 'global',
    joinRoom(config, roomId) {
      const myId = 'peer' + (++counter);
      const members = rooms.get(roomId) || [];
      rooms.set(roomId, members);
      const entry = { selfId: myId, actions: new Map(), room: null };
      const room = {
        selfId: myId,
        makeAction(name) {
          const act = {
            onMessage: null,
            send(data, opts) {
              const target = opts && opts.target;
              tick(() => {
                for (const m of members) {
                  if (m === entry) continue;
                  if (target && m.selfId !== target) continue;
                  const a = m.actions.get(name);
                  if (a && typeof a.onMessage === 'function') a.onMessage(data, { peerId: myId });
                }
              });
            }
          };
          entry.actions.set(name, act);
          return act;
        },
        onPeerJoin: null,
        onPeerLeave: null,
        leave: async () => {
          const i = members.indexOf(entry);
          if (i >= 0) members.splice(i, 1);
          for (const m of members) if (typeof m.room.onPeerLeave === 'function') m.room.onPeerLeave(myId);
        }
      };
      entry.room = room;
      const existing = members.slice();
      members.push(entry);
      tick(() => {
        for (const m of existing) if (typeof m.room.onPeerJoin === 'function') m.room.onPeerJoin(myId);
        for (const m of members) if (m !== entry && typeof room.onPeerJoin === 'function') room.onPeerJoin(m.selfId);
      });
      return room;
    }
  };
}
global.Trystero = MockTrystero();

// ---- 极简引擎（真实规则 + 桩 UI） ----
function fakeEngine() {
  const gs = new GameState();
  const pm = new PieceManager(gs);
  const rv = new RuleValidator(gs, pm);
  gs.ruleValidator = rv;
  pm.ruleValidator = rv;
  const br = { clearSelection() {}, renderPieces() {}, setNetworkMode() {}, setPlayerPosition() {} };
  return {
    gameState: gs, pieceManager: pm, ruleValidator: rv, boardRenderer: br,
    isNetworkMode: false, controlledColors: null, isGameActive: false,
    setControlledColors(c) { this.controlledColors = c ? c.slice() : null; },
    canControl(p) { if (!this.isNetworkMode) return true; return !!this.controlledColors && this.controlledColors.includes(p); },
    updateUI() {}, updateMoveHistory() {},
    startNewGame() { gs.reset(); gs.startGame(); this.isGameActive = true; },
    onMoveCompleted() { gs.checkGameEnd(); },
    endGame() { this.isGameActive = false; }
  };
}

let pass = 0, fail = 0; const failures = [];
function t(name, cond, extra) { if (cond) pass++; else { fail++; failures.push(name + (extra ? '  -> ' + extra : '')); } }
const tick = () => new Promise(r => setTimeout(r, 0));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const hostEngine = fakeEngine();
  const peerEngine = fakeEngine();
  const host = new OnlineSession(hostEngine);
  const peer = new OnlineSession(peerEngine);

  host._open('room1', true);
  peer._open('room1', false);
  await tick(); await tick();

  t('房主看到 2 名参与者', host.participants.length === 2, JSON.stringify(host.participants.map(p => p.id)));
  t('昵称留空生成 6 位字母数字 id', /^[a-z0-9]{6}$/.test(host._randomId()), host._randomId());

  // 昵称：玩家侧上报，房主记录
  host.name = '甲'; peer.name = '乙';
  peer._sendHello();
  await tick(); await tick();
  const peerEntry = host.participants.find(p => p.id !== host.selfId);
  t('房主收到玩家昵称', !!peerEntry && peerEntry.name === '乙', JSON.stringify(host.participants.map(p => p.name)));

  // 模式=四人混战 但只有 2 人 -> 应拒绝开始
  host.settings.mode = 'ffa';
  host.startMatch();
  await tick();
  t('混战模式人数不足时拒绝开始', host.started === false && hostEngine.gameState.gamePhase === 'ready');

  // 模式=两两组队（2 人各控一队）
  host.settings.mode = 'team';
  host.startMatch();
  await tick(); await tick();

  t('房主开始后进入 playing', hostEngine.gameState.gamePhase === 'playing');
  t('玩家收到开局状态', peerEngine.gameState.gamePhase === 'playing');
  t('2 人局座位分配: 房主=[0,1]', eq(host.myColors, [0, 1]), JSON.stringify(host.myColors));
  t('2 人局座位分配: 玩家=[2,3]', eq(peer.myColors, [2, 3]), JSON.stringify(peer.myColors));
  t('玩家端网络模式已开启', peerEngine.isNetworkMode === true);
  t('开局当前玩家=红(0)', hostEngine.gameState.currentPlayer === 0 && peerEngine.gameState.currentPlayer === 0);
  const peerPawn = peerEngine.gameState.getPiece(9, 6);
  t('快照保留兵/卒 facing', !!peerPawn && peerPawn.facing === 'up', JSON.stringify(peerPawn));

  // 房主走红兵 (0,6)->(0,5)，广播后玩家端应同步
  host.requestMove(0, 6, 0, 5);
  await tick(); await tick();
  t('房主的走子已广播到玩家端', !!peerEngine.gameState.getPiece(0, 5));
  t('玩家端当前玩家同步为 绿(2)', peerEngine.gameState.currentPlayer === 2);

  // 玩家走绿兵 (9,6)->(9,5)，房主校验后广播
  peer.requestMove(9, 6, 9, 5);
  await tick(); await tick();
  const hp = hostEngine.gameState.getPiece(9, 5);
  t('玩家的走子经房主校验后生效', !!hp && hp.player === 2, JSON.stringify(hp));
  t('房主端当前玩家轮转到 蓝(1)', hostEngine.gameState.currentPlayer === 1);

  // 移动历史：玩家端也应同步（修“非房主历史为空”）
  t('玩家端移动历史非空', peerEngine.gameState.moveHistory.length === 2, 'peer history=' + peerEngine.gameState.moveHistory.length);

  // 快照携带 moveHistory（重连/重同步后历史不丢，且 captured 会被还原为棋子对象）
  const snap = host._snapshot();
  t('快照包含 moveHistory', Array.isArray(snap.moveHistory) && snap.moveHistory.length === 2);
  peer._onState(Object.assign({}, snap, { seq: snap.seq }));
  t('重同步后玩家端历史保留', peerEngine.gameState.moveHistory.length === 2, 'peer history=' + peerEngine.gameState.moveHistory.length);

  // 非法：玩家尝试移动红方(房主的颜色) -> 应被拒绝，不改变状态
  const before = hostEngine.gameState.turn;
  peer.requestMove(3, 9, 4, 9); // 红兵，属于[0,1]
  await tick(); await tick();
  const src = hostEngine.gameState.getPiece(3, 9);
  const dst = hostEngine.gameState.getPiece(4, 9);
  t('越权走子被拒绝（红兵仍在原位、目标为空）', hostEngine.gameState.turn === before && !!src && src.player === 0 && dst === null);

  // 房主自身走非法棋也会被拦（防经由界面/接口做非法操作）
  const t1 = hostEngine.gameState.turn;
  host.requestMove(3, 7, 4, 7); // 此时并非红方回合
  await tick();
  t('房主自身的非法走棋被拦', hostEngine.gameState.turn === t1 && hostEngine.gameState.getPiece(4, 7) === null);

  // 房主淘汰（认输）会广播到各端
  host.requestResign(2);
  await tick(); await tick();
  t('淘汰结果已广播到玩家端', peerEngine.gameState.pieceCounts[2] === 0 && peerEngine.gameState.getPiece(9, 9) === null);

  // 房主失联接任：选举 + 接任
  t('选举取最小 id', peer._leaderAmong(['c', 'a', 'b']) === 'a');
  peer._becomeHost();
  t('接任后 isHost=true 且名册含自己', peer.isHost === true && peer.participants.some(p => p.token === peer.token));

  // 离开房间：房主保留席位（等待重连），只是标记离线
  await peer.leave(); await tick();
  const seat = host.participants.find(p => p.token !== host.token);
  t('玩家离开后席位保留但标记离线', host.participants.length === 2 && !!seat && seat.id === null, JSON.stringify(host.participants.map(p => ({ id: p.id }))));

  // === 时序回归：一手吃将导致淘汰时，必须“先广播走子、后广播淘汰”，且 move.seq < eliminate.seq ===
  // （否则玩家端会因 d.seq <= lastSeq 丢弃走子而失步）
  {
    const put = (gs, type, player, x, y) => gs.setPiece(x, y, new ChessPiece(type, player, x, y));
    const clearBoard = gs => { for (let x = 0; x < Config.BOARD_SIZE; x++) for (let y = 0; y < Config.BOARD_SIZE; y++) gs.board[x][y] = null; };
    const hEngine = fakeEngine();
    let hRef = null;
    // 让结算像真实引擎那样：先清“将被吃”的残子并广播，再判困毙
    hEngine.onMoveCompleted = function () {
      const gs = this.gameState;
      for (let p = 0; p < 4; p++) {
        if (!gs.hasKing(p) && !gs.eliminationOrder.includes(p)) {
          gs.eliminatePlayer(p);
          if (hRef && hRef.isHost) hRef._broadcastEliminate(p, 'captured');
        }
      }
      gs.checkGameEnd();
      const ko = gs.computeKnockouts(this.ruleValidator);
      for (const k of ko) { gs.eliminatePlayer(k.player); if (hRef && hRef.isHost) hRef._broadcastEliminate(k.player, k.reason); }
      gs.checkGameEnd();
    };
    const h = new OnlineSession(hEngine);
    hRef = h;
    h._open('room-seq', true);
    await tick();
    h.started = true; h.myColors = [0];
    clearBoard(hEngine.gameState);
    put(hEngine.gameState, 'king', 3, 0, 0);   // 黑将
    put(hEngine.gameState, 'rook', 3, 1, 3);   // 黑方残子（待清理）
    put(hEngine.gameState, 'king', 0, 0, 9);   // 红帅
    put(hEngine.gameState, 'rook', 0, 5, 0);   // 红车：走 (5,0)->(0,0) 吃掉黑将
    hEngine.gameState.currentPlayer = 0; hEngine.gameState.gamePhase = 'playing';

    const sends = [];
    const wrap = (act, name) => { if (!act) return; const orig = act.send.bind(act); act.send = (d, o) => { sends.push({ name, seq: d && d.seq }); return orig(d, o); }; };
    wrap(h.actMove, 'move'); wrap(h.actEliminate, 'eliminate');

    h.requestMove(5, 0, 0, 0);
    await tick(); await tick();

    const iMove = sends.findIndex(s => s.name === 'move');
    const iElim = sends.findIndex(s => s.name === 'eliminate');
    t('吃将一手：先发走子、后发淘汰', iMove !== -1 && iElim !== -1 && iMove < iElim, JSON.stringify(sends));
    t('吃将一手：move.seq < eliminate.seq', iMove !== -1 && iElim !== -1 && sends[iMove].seq < sends[iElim].seq, JSON.stringify(sends));
    t('被吃将的黑方已出局（残子清空）', hEngine.gameState.pieceCounts[3] === 0 && hEngine.gameState.getPiece(1, 3) === null);
  }

  console.log(`\n联机协议测试: ${pass} 通过, ${fail} 失败`);
  if (fail) { console.log('\n失败项:'); failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
  console.log('✅ 全部通过');
})();
