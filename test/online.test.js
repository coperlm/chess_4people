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
global.confirm = () => true;   // 求和时用于“是否同意”
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
function fakeEngine(sessionRef) {
  const gs = new GameState();
  const pm = new PieceManager(gs);
  const rv = new RuleValidator(gs, pm);
  gs.ruleValidator = rv;
  pm.ruleValidator = rv;
  const br = { clearSelection() {}, renderPieces() {}, setNetworkMode() {}, setPlayerPosition() {} };
  return {
    gameState: gs, pieceManager: pm, ruleValidator: rv, boardRenderer: br,
    isNetworkMode: false, controlledColors: null, isGameActive: false, gameStartTime: null, _sessionRef: sessionRef,
    setControlledColors(c) { this.controlledColors = c ? c.slice() : null; },
    canControl(p) { if (!this.isNetworkMode) return true; return !!this.controlledColors && this.controlledColors.includes(p); },
    updateUI() {}, updateMoveHistory() {},
    startNewGame() { gs.reset(); gs.startGame(); this.isGameActive = true; },
    onMoveCompleted() { gs.checkGameEnd(); },
    // 与真实引擎一致：只“通报 + 广播”，淘汰由调用方先做
    notifyKnockout(player, reason) {
      const s = this._sessionRef && this._sessionRef.current;
      if (s && s.isHost && s.active) s._broadcastEliminate(player, reason);
    },
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
  t('玩家端也有本局开始时间（避免结算“游戏时长：未知”）', typeof peerEngine.gameStartTime === 'number', String(peerEngine.gameStartTime));
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

  // === 求和：提议 → 对方同意 → 双方和棋 ===
  {
    const hEngine = fakeEngine();
    const pEngine = fakeEngine();
    const h = new OnlineSession(hEngine);
    const p = new OnlineSession(pEngine);
    h._open('room-draw', true);
    p._open('room-draw', false);
    await tick(); await tick();
    h.name = '甲'; p.name = '乙';
    p._sendHello();
    await tick(); await tick();
    h.settings.mode = 'team';
    h.startMatch();
    await tick(); await tick();
    h.requestDraw();
    await tick(); await tick(); await tick();
    t('求和：发起后对方同意 => 房主判定和棋', hEngine.gameState.gamePhase === 'finished' && hEngine.gameState.isDraw === true);
  }

  // === 回归：已在房间时再次 _open（如刷新后重连、连点创建），新会话不应被旧 leave() 的收尾冲掉 ===
  {
    const e = fakeEngine();
    const s = new OnlineSession(e);
    s._open('room-a', true);
    await tick(); await tick();
    t('首次建房：名册含房主', s.active === true && s.participants.length === 1 && s.participants[0].token === s.token);
    s._open('room-b', true);   // 再次建房（旧 room 仍在）
    await tick(); await tick();
    t('再次建房：新会话未被旧收尾冲掉', s.active === true && s.roomId === 'room-b' && s.participants.length === 1 && s.participants[0].token === s.token, JSON.stringify({ active: s.active, room: s.roomId, n: s.participants.length }));
  }

  // === 3 人组队：各控一色，第 4 色整色移除，且不计入“出局” ===
  {
    const hEngine = fakeEngine(), e1 = fakeEngine(), e2 = fakeEngine();
    const h = new OnlineSession(hEngine), p1 = new OnlineSession(e1), p2 = new OnlineSession(e2);
    h._open('room-3p', true); p1._open('room-3p', false); p2._open('room-3p', false);
    await tick(); await tick();
    h.name = '甲'; p1.name = '乙'; p2.name = '丙';
    p1._sendHello(); p2._sendHello(); await tick(); await tick();
    h.settings.mode = 'team'; h.startMatch(); await tick(); await tick();
    const gs = hEngine.gameState;
    t('3 人组队：三人各控一色', eq(h.myColors, [0]) && eq(p1.myColors, [1]) && eq(p2.myColors, [2]), JSON.stringify([h.myColors, p1.myColors, p2.myColors]));
    t('3 人组队：第 4 色整色移除、计数归零', gs.pieceCounts[3] === 0 && !gs.hasKing(3), JSON.stringify(gs.pieceCounts));
    t('3 人组队：第 4 色不计入出局、未误判终局', !gs.eliminationOrder.includes(3) && gs.gamePhase === 'playing', JSON.stringify({ elim: gs.eliminationOrder, phase: gs.gamePhase }));
    t('3 人组队：客户端也移除第 4 色', e1.gameState.pieceCounts[3] === 0 && e2.gameState.pieceCounts[3] === 0);
  }

  // === 3 人混战：现在允许（3~4 人），各控一色、第 4 色移除 ===
  {
    const hEngine = fakeEngine(), e1 = fakeEngine(), e2 = fakeEngine();
    const h = new OnlineSession(hEngine), p1 = new OnlineSession(e1), p2 = new OnlineSession(e2);
    h._open('room-3f', true); p1._open('room-3f', false); p2._open('room-3f', false);
    await tick(); await tick();
    h.name = '甲'; p1.name = '乙'; p2.name = '丙';
    p1._sendHello(); p2._sendHello(); await tick(); await tick();
    h.settings.mode = 'ffa'; h.startMatch(); await tick(); await tick();
    const gs = hEngine.gameState;
    t('3 人混战：允许开局', gs.gamePhase === 'playing');
    t('3 人混战：各控一色、第 4 色移除', eq(h.myColors, [0]) && eq(p1.myColors, [1]) && eq(p2.myColors, [2]) && gs.pieceCounts[3] === 0, JSON.stringify([h.myColors, p1.myColors, p2.myColors, gs.pieceCounts]));
  }

  // === 回归：联机认输不应抛错（曾误用 this.gameState 导致“认输”直接报错） ===
  {
    const hEngine = fakeEngine(); const pEngine = fakeEngine();
    const h = new OnlineSession(hEngine); const p = new OnlineSession(pEngine);
    h._open('room-resign', true); p._open('room-resign', false);
    await tick(); await tick();
    h.name = '甲'; p.name = '乙'; p._sendHello(); await tick(); await tick();
    h.settings.mode = 'team'; h.startMatch(); await tick(); await tick();
    const peerColors = p.myColors.slice();
    let threw = false;
    try { p.requestResignSelf(); } catch (e) { threw = true; }
    await tick(); await tick();
    t('联机认输不抛错', threw === false);
    t('认输后其颜色被淘汰', peerColors.every(c => hEngine.gameState.pieceCounts[c] === 0), JSON.stringify(hEngine.gameState.pieceCounts));
  }

  // === 房主管理：开局前可交换位置/颜色（开局中禁止） + 踢人 + 全员在线状态 ===
  {
    const href = { current: null };
    const hEngine = fakeEngine(href);
    const pEngine = fakeEngine();
    const h = new OnlineSession(hEngine); href.current = h;
    const p = new OnlineSession(pEngine);
    h._open('room-admin', true);
    p._open('room-admin', false);
    await tick(); await tick();
    h.name = '房主A'; p.name = '玩家B';
    p._sendHello();
    await tick(); await tick();
    h.settings.mode = 'team';

    const peerToken = h.participants.find(x => x.token !== h.token).token;

    // 开局前交换：允许（把房主换到对方的槽位）
    h.swapWithHost(peerToken);
    await tick(); await tick();
    t('开局前可交换：房主换到对方槽位', h.participants[0].token !== h.token, JSON.stringify(h.participants.map(x => x.token)));

    h.startMatch();
    await tick(); await tick();
    const hostColors0 = h.myColors.slice();   // 交换后房主应拿到原属对方的 [2,3]
    const peerColors0 = p.myColors.slice();   // 对方应拿到原属房主的 [0,1]
    t('开局前交换在开局时生效：房主=[2,3]', eq(hostColors0, [2, 3]), JSON.stringify(hostColors0));
    t('开局前交换在开局时生效：对方=[0,1]', eq(peerColors0, [0, 1]), JSON.stringify(peerColors0));

    // 开局中交换：禁止（颜色保持不变）
    h.swapWithHost(peerToken);
    await tick(); await tick();
    t('开局中禁止交换（房主颜色不变）', eq(h.myColors, hostColors0), JSON.stringify(h.myColors));
    t('开局中禁止交换（对方颜色不变）', eq(p.myColors, peerColors0), JSON.stringify(p.myColors));

    // 全员在线状态（非房主名册带 online 字段）
    const seats = p._roster && p._roster.seats;
    t('非房主名册携带 online 字段', Array.isArray(seats) && seats.length === 2 && seats.every(s => typeof s.online === 'boolean'), JSON.stringify(seats));

    // 踢人（开局中：淘汰其“当前”颜色，保持棋盘/回合一致）
    const peerNow = p.myColors.slice();
    h.kickParticipant(peerToken);
    await tick(); await tick(); await tick();
    t('踢人后名册只剩房主', h.participants.length === 1 && h.participants[0].token === h.token);
    t('踢人后其颜色被淘汰（棋盘一致）', peerNow.every(c => hEngine.gameState.pieceCounts[c] === 0), JSON.stringify(peerNow) + ' => ' + JSON.stringify(hEngine.gameState.pieceCounts));
    t('被踢者已离开房间', p.active === false);
    t('踢人不会把房主自己踢掉', h.active === true && h.participants.some(x => x.token === h.token));
  }

  // === 求和排除观战者：只需参战玩家同意，观战者不弹窗也不否决 ===
  {
    const eng = [fakeEngine(), fakeEngine(), fakeEngine(), fakeEngine(), fakeEngine()];
    const s = eng.map(e => new OnlineSession(e));
    s[0].token = 'H'; s[0]._open('room-spec', true);
    for (let i = 1; i < 5; i++) { s[i].token = 'S' + i; s[i]._open('room-spec', false); }
    await tick(); await tick();
    s[0].name = 'H';
    for (let i = 1; i < 5; i++) { s[i].name = 'S' + i; s[i]._sendHello(); }
    await tick(); await tick();
    s[0].settings.mode = 'team'; s[0].startMatch(); await tick(); await tick();
    const players = s.filter(x => x.myColors.length);
    const spectators = s.filter(x => !x.myColors.length);
    t('5 人：4 名参战 + 1 名观战', players.length === 4 && spectators.length === 1, JSON.stringify(s.map(x => x.myColors)));
    // 观战者尝试求和应被拒
    spectators[0].requestDraw(); await tick();
    t('观战者不能发起求和', s[0].gameEngine.gameState.isDraw !== true);
    // 房主发起求和：4 名参战者同意（confirm 桩为 true），观战者不参与 → 成立
    s[0].requestDraw();
    await tick(); await tick(); await tick(); await tick();
    t('观战者不否决：求和仍成立', s[0].gameEngine.gameState.isDraw === true && s[0].gameEngine.gameState.gamePhase === 'finished', JSON.stringify({ draw: s[0].gameEngine.gameState.isDraw, phase: s[0].gameEngine.gameState.gamePhase }));
  }

  // === 掉线：所有人可见 + 房主 30s 后自动跳过其回合（用直接调用 _skipOfflineTurn 代替等待）===
  {
    const hE = fakeEngine(), aE = fakeEngine(), bE = fakeEngine();
    const h = new OnlineSession(hE), a = new OnlineSession(aE), b = new OnlineSession(bE);
    h.token = 'H'; a.token = 'A'; b.token = 'B';
    h._open('room-off', true);
    a._open('room-off', false);
    b._open('room-off', false);
    await tick(); await tick(); await tick();
    h.name = '房主'; a.name = '甲'; b.name = '乙';
    a._sendHello(); b._sendHello();
    await tick(); await tick();
    h.settings.mode = 'team';
    h.startMatch();
    await tick(); await tick();

    // 3 人组队：房主=[0], 甲=[1], 乙=[2]
    t('3 人组队各控一色', eq(h.myColors, [0]) && eq(a.myColors, [1]) && eq(b.myColors, [2]), JSON.stringify([h.myColors, a.myColors, b.myColors]));

    // 甲掉线
    await a.leave();
    await tick(); await tick();
    const aEntry = h.participants.find(x => x.token === 'A');
    t('房主侧：离线者保留席位并标记离线', !!aEntry && aEntry.id === null);
    const bSeats = (b._roster && b._roster.seats) || [];
    const aSeat = bSeats.find(s => s.name === '甲');
    t('其他玩家也能看到“甲”离线', !!aSeat && aSeat.online === false, JSON.stringify(bSeats.map(s => ({ n: s.name, on: s.online }))));

    // 轮到甲(蓝=1)：房主应开始 30s 倒计时
    hE.gameState.currentPlayer = 1;
    h._checkOfflineTurn();
    t('轮到离线玩家时房主开始跳过计时', !!h._offlineTimer);

    // 甲重连 → 撤销计时
    h._onHello({ token: 'A', name: '甲' }, 'peerA2');
    await tick();
    t('离线玩家重连后撤销跳过计时', !h._offlineTimer);

    // 再次离线并到期 → 直接触发跳过（不等待 30s）
    h.participants.find(x => x.token === 'A').id = null;
    hE.gameState.currentPlayer = 1;
    h._checkOfflineTurn();
    t('再次轮到离线玩家重新开始计时', !!h._offlineTimer);
    h._skipOfflineTurn();
    await tick(); await tick();
    t('超时后自动跳过该离线玩家的回合且不淘汰其棋子', hE.gameState.currentPlayer === 0 && hE.gameState.pieceCounts[1] > 0, 'cp=' + hE.gameState.currentPlayer + ' cnt=' + hE.gameState.pieceCounts[1]);
    t('跳过后无悬挂计时器（下一位在线）', !h._offlineTimer);

    // 房主踢掉离线者 → 其棋子全部清空
    h.kickParticipant('A');
    await tick(); await tick();
    t('房主踢掉离线者后其颜色棋子全部清空', [1].every(c => hE.gameState.pieceCounts[c] === 0), JSON.stringify(hE.gameState.pieceCounts));
    h._clearOfflineTimer();
  }

  // === 房主断线重连：必须恢复房主自己的颜色（否则会变成“观战”），且名册不重复 ===
  {
    const hE = fakeEngine();
    hE.persistence = { loadGameState: () => ({ gamePhase: 'playing' }), restoreGameState: () => {}, clearSavedState: () => {} };
    const h = new OnlineSession(hE);
    h.token = 'HOST';
    const record = {
      roomId: 'room-resume', isHost: true, token: 'HOST', started: true,
      settings: { mode: 'team', victory: 'any_king', friendlyFire: false },
      roster: [
        { token: 'HOST', name: '房主', colors: [0, 1] },
        { token: 'PEER', name: '乙', colors: [2, 3] },
        { token: 'PEER', name: '乙', colors: [2, 3] }   // 故意塞一条重复，验证去重
      ]
    };
    h._resuming = true;
    h._open('room-resume', true, record);
    await tick(); await tick();
    t('房主重连恢复自己的颜色', eq(h.myColors, [0, 1]), JSON.stringify(h.myColors));
    t('房主重连仍是参战者且已开局', h.myColors.length > 0 && h.started === true);
    t('房主重连后名册去重（房主+1人）', h.participants.length === 2, JSON.stringify(h.participants.map(p => p.token)));
    t('房主重连席位颜色正确', eq(h.participants[0].colors, [0, 1]), JSON.stringify(h.participants.map(p => p.colors)));
  }

  console.log(`\n联机协议测试: ${pass} 通过, ${fail} 失败`);
  if (fail) { console.log('\n失败项:'); failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
  console.log('✅ 全部通过');
})();
