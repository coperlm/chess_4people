/**
 * 联机随机压力测试（2 人 / 4 人）
 * 用内存版 Trystero 模拟多个浏览器，随机走子 + 随机操作（悔棋/认输/求和/踢人/交换），
 * 每一步后比对“房主与非房主”的棋盘状态，查失步（desync）与异常。
 * 运行: node test/netstress.test.js [twoPlayerGames] [fourPlayerGames]
 */

global.document = {
  getElementById: () => null,
  createElement: () => ({ classList: { add() {}, remove() {}, contains() {} }, style: {}, appendChild() {} }),
  addEventListener() {}
};
global.window = {};
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.confirm = () => true;   // 求和询问 / 认输确认

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

// ---- 内存版 Trystero（用 setImmediate，快且保序） ----
function MockTrystero() {
  const rooms = new Map();
  let counter = 0;
  const tick = fn => setImmediate(fn);
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

function fakeEngine(ref) {
  const gs = new GameState();
  const pm = new PieceManager(gs);
  const rv = new RuleValidator(gs, pm);
  gs.ruleValidator = rv; pm.ruleValidator = rv;
  const br = { clearSelection() {}, renderPieces() {}, setNetworkMode() {}, setPlayerPosition() {} };
  return {
    gameState: gs, pieceManager: pm, ruleValidator: rv, boardRenderer: br,
    isNetworkMode: false, controlledColors: null, isGameActive: false, gameStartTime: null, _sessionRef: ref,
    setControlledColors(c) { this.controlledColors = c ? c.slice() : null; },
    canControl(p) { if (!this.isNetworkMode) return true; return !!this.controlledColors && this.controlledColors.includes(p); },
    updateUI() {}, updateMoveHistory() {},
    startNewGame() { gs.reset(); gs.startGame(); this.isGameActive = true; },
    // 忠实复刻生产端 GameEngine.resolveAfterMove / onMoveCompleted
    resolveAfterMove() {
      let guard = 0, finished = false;
      while (gs.gamePhase === 'playing' && guard++ < 8) {
        for (let p = 0; p < 4; p++) if (!gs.hasKing(p) && !gs.eliminationOrder.includes(p)) { gs.eliminatePlayer(p); this.notifyKnockout(p, 'captured'); }
        if (gs.checkGameEnd()) { finished = true; break; }
        const kn = gs.computeKnockouts(rv);
        if (!kn.length) break;
        for (const k of kn) { gs.eliminatePlayer(k.player); this.notifyKnockout(k.player, k.reason); }
        if (gs.checkGameEnd()) { finished = true; break; }
        if (!gs.hasKing(gs.currentPlayer)) gs.nextPlayer();
      }
      if (finished) this.endGame();
    },
    onMoveCompleted() { this.resolveAfterMove(); },
    notifyKnockout(player, reason) { const s = this._sessionRef && this._sessionRef.current; if (s && s.isHost && s.active) s._broadcastEliminate(player, reason); },
    // 与真实引擎一致：endGame 会经 window.onlineSession.onGameEnd 广播（测试里用 sessionRef 复刻，仅房主广播）
    endGame() { this.isGameActive = false; const s = this._sessionRef && this._sessionRef.current; if (s && s.isHost && s.active) s.onGameEnd(); }
  };
}

const tick = () => new Promise(r => setImmediate(r));
const settle = async (n = 4) => { for (let i = 0; i < n; i++) await tick(); };

function sig(session) {
  const gs = session.gameEngine.gameState;
  let b = '';
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) { const p = gs.board[x][y]; b += p ? (p.type[0] + p.player + (p.facing || '')) : '.'; }
  return b + '|cp' + gs.currentPlayer + '|t' + gs.turn + '|' + gs.gamePhase + '|' + JSON.stringify(gs.pieceCounts)
    + '|h' + gs.moveHistory.length + '|e' + gs.eliminationOrder.join(',') + '|d' + (gs.isDraw ? 1 : 0) + '|w' + gs.winner;
}

function legalMoves(gs, rv) {
  const p = gs.currentPlayer; const out = [];
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) {
    const pc = gs.board[x][y];
    if (pc && pc.player === p) for (const mv of rv.getValidMoves(x, y)) out.push([x, y, mv.x, mv.y]);
  }
  return out;
}

function makeRng(seed) { return function () { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function runGame(n, rng, roomId, stats, maxPlies) {
  const hostRef = { current: null };
  const hostEngine = fakeEngine(hostRef);
  const host = new OnlineSession(hostEngine); hostRef.current = host;
  const peers = [];
  host._open(roomId, true);
  for (let i = 1; i < n; i++) {
    const e = fakeEngine(); const s = new OnlineSession(e);
    peers.push(s);
    s.token = 'T' + i;
    s._open(roomId, false);
  }
  await settle(3);
  host.name = 'H';
  for (let i = 0; i < peers.length; i++) { peers[i].name = 'P' + (i + 1); peers[i]._sendHello(); }
  await settle(4);
  if (host.participants.length !== n) { stats.badHandshake++; return; }

  const mode = n === 2 ? 'team' : (rng() < 0.5 ? 'ffa' : 'team');
  const victory = rng() < 0.5 ? 'any_king' : 'last_team';
  host.settings.mode = mode; host.settings.victory = victory; host.settings.friendlyFire = rng() < 0.5;
  host.name = 'H'; // startMatch 用 UI 的 modeSelect 覆盖，这里直接设 settings 后手动调用 _groupsFor 路径
  // 直接调用内部流程，绕开 _readSettingsFromUI（测试无 UI 元素）
  const groups = host._groupsFor(n);
  host.participants.forEach((p, i) => { p.colors = groups[i] || []; });
  host.participants.forEach((p, i) => {
    if (p.token === host.token) host._setMyColors(p.colors);
    else if (p.id) host.actAssign.send({ colors: p.colors, seat: i, hostId: host.selfId, settings: host.settings }, { target: p.id });
  });
  host.started = true;
  hostEngine.gameState.reset(); hostEngine.gameState.setRules(host.settings); hostEngine.gameState.startGame();
  hostEngine.isGameActive = true; hostEngine.gameStartTime = Date.now();
  host._broadcastRoster(); host._broadcastState();
  await settle(4);

  const all = [host, ...peers];

  let plies = 0;
  const acts = [];
  for (let step = 0; step < maxPlies * 3 && plies < maxPlies; step++) {
    const hs = hostEngine.gameState;
    if (hs.gamePhase !== 'playing') break;
    const r = rng();
    const actSet = new Set((process.env.ACT || 'all').split(','));
    const can = k => actSet.has('all') || actSet.has(k);
    let act = '';
    try {
      if (r < 0.86) {
        const cp = hs.currentPlayer;
        const ctrl = all.find(s => s.active && (s.myColors || []).includes(cp));
        if (!ctrl) { act = 'noController(cp' + cp + ')'; }
        else {
          const mv = legalMoves(hostEngine.gameState, hostEngine.ruleValidator);
          if (!mv.length) { act = 'noMoves'; }
          else {
            const m = mv[Math.floor(rng() * mv.length)];
            act = 'move ' + (ctrl === host ? 'H' : ctrl.name) + ' ' + m.join(',');
            ctrl.requestMove(m[0], m[1], m[2], m[3]);
            plies++;
          }
        }
      } else if (r < 0.92 && can('undo')) {
        const s = all[Math.floor(rng() * all.length)];
        if (s && s.active) { act = 'undo ' + s.name; s.requestUndo(); }
      } else if (r < 0.95 && can('resign')) {
        const s = all[Math.floor(rng() * all.length)];
        if (s && s.active) { act = 'resign ' + s.name; s.requestResignSelf(); }
      } else if (r < 0.98 && can('draw')) {
        const s = all[Math.floor(rng() * all.length)];
        if (s && s.active) { act = 'draw ' + s.name; s.requestDraw(); }
      } else if (r < 0.995 && can('swap')) {
        const other = host.participants.find(p => p.token !== host.token);
        if (other) { act = 'swap'; host.swapWithHost(other.token); }
      } else if (can('kick')) {
        const other = host.participants.find(p => p.token !== host.token);
        if (other && host.participants.length > 2) { act = 'kick'; host.kickParticipant(other.token); }
      }
    } catch (e) {
      stats.errors.push('game ' + roomId + ': ' + (e && e.message));
      break;
    }
    acts.push(act);
    await settle(8);

    // 一致性：房主 vs 每个仍然在房间里的会话
    const hs2 = sig(host);
    for (const s of all) {
      if (s === host) continue;
      if (!s.active) continue;           // 被踢/离开的不比
      const ss = sig(s);
      if (ss !== hs2) {
        stats.desync++;
        if (stats.desyncSample.length < 2) {
          const info = x => { const g = x.gameEngine.gameState; return { cp: g.currentPlayer, turn: g.turn, phase: g.gamePhase, counts: g.pieceCounts, elim: g.eliminationOrder, elimLog: g.eliminationLog, hLen: g.moveHistory.length, hasKing: [0, 1, 2, 3].map(p => g.hasKing(p)), lastSeq: x._lastSeq, seq: x.seq }; };
          stats.desyncSample.push({ room: roomId, step, acts: acts.slice(-6), H: info(host), P: info(s) });
        }
        return;
      }
    }
  }
  stats.games++;
  stats.plies += plies;
  if (hostEngine.gameState.gamePhase === 'finished') stats.finished++;
  for (const s of all) { try { await s.leave(); } catch (e) {} }
}

(async () => {
  const N2 = parseInt(process.argv[2] || '200', 10);   // 可传参放大：node test/netstress.test.js 3000 2000
  const N4 = parseInt(process.argv[3] || '150', 10);
  const stats = { games: 0, plies: 0, finished: 0, desync: 0, errors: [], badHandshake: 0, desyncSample: [] };
  const rng = makeRng(20261006);
  const t0 = Date.now();
  for (let g = 0; g < N2; g++) await runGame(2, rng, 'r2-' + g, stats, 80);
  for (let g = 0; g < N4; g++) await runGame(4, rng, 'r4-' + g, stats, 80);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n联机随机压力: ${N2} 局(2人) + ${N4} 局(4人) = ${stats.games} 局 / ${stats.plies} 手，用时 ${secs}s`);
  console.log(`正常结束 ${stats.finished} 局；失步 ${stats.desync}；握手失败 ${stats.badHandshake}；异常 ${stats.errors.length}`);
  if (stats.desyncSample.length) console.log('失步样例:', JSON.stringify(stats.desyncSample.slice(0, 2), null, 1));
  if (stats.errors.length) console.log('异常样例:', stats.errors.slice(0, 8));
  console.log(stats.desync === 0 && stats.errors.length === 0 && stats.badHandshake === 0 ? '✅ 全部通过' : '❌ 存在问题');
  process.exit(stats.desync === 0 && stats.errors.length === 0 && stats.badHandshake === 0 ? 0 : 1);
})();
