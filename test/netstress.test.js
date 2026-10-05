/**
 * 联机随机压力测试（2/3/4/5 人，真实协议往返）
 * - 随机走子 + 随机操作：悔棋、认输、求和、交换、踢人、中途加入、掉线重连、重开、重同步
 * - 每步后：①逐端本地不变量（坐标/计数/出局一致）②房主 vs 各端逐字段比对（查失步）
 * 运行: node test/netstress.test.js [n2] [n3] [n4] [n5]
 *   ACT=undo,resign 只启用指定操作；MOVES_ONLY=1 只走子
 */
global.document = {
  getElementById: () => null,
  createElement: () => ({ classList: { add() {}, remove() {}, contains() {} }, style: {}, appendChild() {} }),
  addEventListener() {}
};
global.window = {};
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.confirm = () => true;

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
    // 忠实复刻生产端 GameEngine.resolveAfterMove / onMoveCompleted（困毙只判“轮到该方”）
    resolveAfterMove() {
      let guard = 0, finished = false;
      while (gs.gamePhase === 'playing' && guard++ < 8) {
        for (let p = 0; p < 4; p++) if (!gs.hasKing(p) && !gs.eliminationOrder.includes(p) && !gs.outOfPlay.includes(p)) { gs.eliminatePlayer(p); this.notifyKnockout(p, 'captured'); }
        if (gs.checkGameEnd()) { finished = true; break; }
        if (!gs.hasKing(gs.currentPlayer)) { gs.nextPlayer(); continue; }
        const cur = gs.currentPlayer;
        if (!gs.currentPlayerStuck(rv)) break;
        gs.eliminatePlayer(cur);
        this.notifyKnockout(cur, 'stalemate');
        if (gs.checkGameEnd()) { finished = true; break; }
        gs.nextPlayer();
      }
      if (finished) this.endGame();
    },
    onMoveCompleted() { this.resolveAfterMove(); },
    notifyKnockout(player, reason) { const s = this._sessionRef && this._sessionRef.current; if (s && s.isHost && s.active) s._broadcastEliminate(player, reason); },
    endGame() { this.isGameActive = false; const s = this._sessionRef && this._sessionRef.current; if (s && s.isHost && s.active) s.onGameEnd(); }
  };
}

const tick = () => new Promise(r => setImmediate(r));
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await tick(); };
function makeRng(seed) { return function () { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function sig(session) {
  const gs = session.gameEngine.gameState;
  let b = '';
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) { const p = gs.board[x][y]; b += p ? (p.type[0] + p.player + (p.facing || '')) : '.'; }
  return b + '|cp' + gs.currentPlayer + '|t' + gs.turn + '|' + gs.gamePhase + '|' + JSON.stringify(gs.pieceCounts)
    + '|h' + gs.moveHistory.length + '|e' + gs.eliminationOrder.join(',') + '|o' + gs.outOfPlay.join(',') + '|d' + (gs.isDraw ? 1 : 0) + '|w' + gs.winner;
}
/** 单端本地不变量 */
function localInv(session) {
  const gs = session.gameEngine.gameState;
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) {
    const p = gs.board[x][y]; if (!p) continue;
    if (p.x !== x || p.y !== y) return 'coord';
    counts[p.player]++;
  }
  for (const k of [0, 1, 2, 3]) if (counts[k] !== gs.pieceCounts[k]) return 'count P' + k;
  for (const k of [0, 1, 2, 3]) {
    if (!gs.hasKing(k) && !gs.eliminationOrder.includes(k) && !gs.outOfPlay.includes(k)) return 'kingless-not-elim P' + k;
    if (gs.eliminationOrder.includes(k) && counts[k] !== 0) return 'elim-has-pieces P' + k;
    if (gs.outOfPlay.includes(k) && counts[k] !== 0) return 'outofplay-has-pieces P' + k;
  }
  return null;
}
function legalMoves(gs, rv) {
  const p = gs.currentPlayer; const out = [];
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) {
    const pc = gs.board[x][y];
    if (pc && pc.player === p) for (const mv of rv.getValidMoves(x, y)) out.push([x, y, mv.x, mv.y]);
  }
  return out;
}

async function runGame(n, rng, roomId, stats, maxPlies) {
  const actSet = new Set((process.env.ACT || 'all').split(','));
  const can = k => !process.env.MOVES_ONLY && (actSet.has('all') || actSet.has(k));

  const hostRef = { current: null };
  const host = new OnlineSession(fakeEngine(hostRef)); hostRef.current = host;
  const peers = [];
  host.token = 'H'; host._open(roomId, true);
  for (let i = 1; i < n; i++) { const s = new OnlineSession(fakeEngine()); s.token = 'P' + i; peers.push(s); s._open(roomId, false); }
  await settle(3);
  host.name = 'H';
  peers.forEach((s, i) => { s.name = 'P' + (i + 1); s._sendHello(); });
  await settle(4);
  if (host.participants.length !== n) { stats.badHandshake++; return; }

  const mode = (n >= 3 && rng() < 0.5) ? 'ffa' : 'team';   // 混战 3~4 人；组队 2~4 人
  host.settings.mode = mode;
  host.settings.victory = rng() < 0.5 ? 'any_king' : 'last_team';
  host.settings.friendlyFire = rng() < 0.5;
  host.name = 'H';

  const startGame = () => {
    const cnt = host.participants.length;
    const groups = host._groupsFor(cnt);
    host.participants.forEach((p, i) => { p.colors = groups[i] || []; });
    host.participants.forEach((p, i) => {
      if (p.token === host.token) host._setMyColors(p.colors);
      else if (p.id) host.actAssign.send({ colors: p.colors, seat: i, hostId: host.selfId, settings: host.settings }, { target: p.id });
    });
    host.started = true;
    hostEngineReset();
    // 未被分配的颜色（如 3 人组队时的第 4 色）整色移除，与生产 startMatch 一致
    const assigned = new Set(); host.participants.forEach(p => (p.colors || []).forEach(c => assigned.add(c)));
    for (let c = 0; c < 4; c++) if (!assigned.has(c)) host.gameEngine.gameState.removeColor(c);
    host._broadcastRoster(); host._broadcastState();
  };
  const hostEngineReset = () => { const gs = host.gameEngine.gameState; gs.reset(); gs.setRules(host.settings); gs.startGame(); host.gameEngine.isGameActive = true; host.gameEngine.gameStartTime = Date.now(); };
  startGame();
  await settle(4);

  const all = [host, ...peers];
  let joinSeq = 0;

  let plies = 0;
  for (let step = 0; step < maxPlies * 3 && plies < maxPlies; step++) {
    const hs = host.gameEngine.gameState;
    if (hs.gamePhase !== 'playing') break;
    const cp = hs.currentPlayer;
    const ctrl = all.find(s => s.active && (s.myColors || []).includes(cp));
    const pickS = () => all[Math.floor(rng() * all.length)];
    const r = rng();
    try {
      if (r < 0.80 || !can('anyNonMove')) {
        if (!ctrl) { /* 该色无人控制：跳过 */ }
        else {
          const mv = legalMoves(hs, host.gameEngine.ruleValidator);
          if (mv.length) { const m = mv[Math.floor(rng() * mv.length)]; ctrl.requestMove(m[0], m[1], m[2], m[3]); plies++; }
        }
      } else if (r < 0.85 && can('undo')) {
        const s = pickS(); if (s && s.active) s.requestUndo();
      } else if (r < 0.88 && can('resign')) {
        const s = pickS(); if (s && s.active) s.requestResignSelf();
      } else if (r < 0.91 && can('draw')) {
        const s = pickS(); if (s && s.active) s.requestDraw();
      } else if (r < 0.93 && can('swap')) {
        const other = host.participants.find(p => p.token !== host.token); if (other) host.swapWithHost(other.token);
      } else if (r < 0.95 && can('kick')) {
        const other = host.participants.find(p => p.token !== host.token); if (other && host.participants.length > 2) host.kickParticipant(other.token);
      } else if (r < 0.97 && can('join') && all.length < 6) {
        const s = new OnlineSession(fakeEngine()); s.token = 'J' + (++joinSeq); s.name = 'J' + joinSeq;
        all.push(s); s._open(roomId, false); await settle(2); s._sendHello();
      } else if (r < 0.985 && can('leaveRejoin')) {
        const s = pickS();
        if (s && s.active && s !== host) { await s.leave(); await settle(2); s._open(roomId, false); await settle(2); s._sendHello(); }
      } else if (can('rematch')) {
        if (hs.gamePhase === 'finished') { startGame(); }
        else if (can('resync')) { const s = pickS(); if (s && s.active && !s.isHost) s.actIntent.send({ kind: 'resync' }); }
      }
    } catch (e) {
      stats.errors.push('game ' + roomId + ': ' + (e && e.message));
      break;
    }
    await settle(8);

    // ① 本地不变量
    let bad = null;
    for (const s of all) { if (!s.active) continue; const e = localInv(s); if (e) { bad = s.name + ':' + e; break; } }
    if (bad) { stats.localBad++; if (stats.samples.length < 3) stats.samples.push({ room: roomId, step, local: bad }); return; }
    // ② 跨端一致
    const hs2 = sig(host);
    for (const s of all) {
      if (s === host || !s.active) continue;
      if (sig(s) !== hs2) {
        stats.desync++;
        if (stats.samples.length < 3) {
          const info = x => { const g = x.gameEngine.gameState; return { name: x.name, cp: g.currentPlayer, turn: g.turn, phase: g.gamePhase, counts: g.pieceCounts, elim: g.eliminationOrder, hLen: g.moveHistory.length, hasKing: [0, 1, 2, 3].map(p => g.hasKing(p)) }; };
          stats.samples.push({ room: roomId, step, H: info(host), P: info(s) });
        }
        return;
      }
    }
  }
  stats.games++;
  stats.plies += plies;
  if (host.gameEngine.gameState.gamePhase === 'finished') stats.finished++;
  for (const s of all) { try { await s.leave(); } catch (e) {} }
}

(async () => {
  const c = (process.argv[2] !== undefined) ? process.argv.slice(2) : ['200', '120', '200', '80'];
  const Ns = [2, 3, 4, 5].map((n, i) => ({ n, count: parseInt(c[i] || '0', 10) }));
  const stats = { games: 0, plies: 0, finished: 0, desync: 0, localBad: 0, badHandshake: 0, errors: [], samples: [] };
  const rng = makeRng(20261007);
  const t0 = Date.now();
  for (const { n, count } of Ns) for (let g = 0; g < count; g++) { await runGame(n, rng, `r${n}-${g}`, stats, 80); if (stats.desync > 2 || stats.localBad > 2 || stats.errors.length > 2) break; }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n联机随机压力: ${Ns.map(x => x.count + '局(' + x.n + '人)').join(' + ')} = ${stats.games} 局 / ${stats.plies} 手，用时 ${secs}s`);
  console.log(`正常结束 ${stats.finished} 局；失步 ${stats.desync}；本地不变量失败 ${stats.localBad}；握手失败 ${stats.badHandshake}；异常 ${stats.errors.length}`);
  if (stats.samples.length) console.log('样例:', JSON.stringify(stats.samples.slice(0, 3), null, 1));
  if (stats.errors.length) console.log('异常:', stats.errors.slice(0, 5));
  const ok = stats.desync === 0 && stats.localBad === 0 && stats.badHandshake === 0 && stats.errors.length === 0 && stats.games > 0;
  console.log(ok ? '✅ 全部通过' : '❌ 存在问题');
  process.exit(ok ? 0 : 1);
})();
