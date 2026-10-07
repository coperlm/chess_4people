/**
 * 联机模拟测试公共设施（仅供 test/ 使用，不参与生产代码）
 *
 * 与 test/online.test.js、netstress.test.js 里的内存版 Trystero 相比，这里多了两样：
 *   1) 虚拟时钟：把「离线跳过」「房主失联接任」这类真实等待变成瞬间步进，
 *      于是可以在几秒内穷举大量“时序”组合；Date.now / setTimeout / setInterval 全部受控。
 *   2) 传输层“掉线/重连”钩子：WebRTC 数据通道是可靠且有序的，所以真实的意外不是丢包/乱序，
 *      而是**对端掉线**（他人收到 onPeerLeave）与**重连**（onPeerJoin）。__drop 模拟前者，
 *      重连则由一个同 token 的新会话 _open + _sendHello 模拟（等价于刷新页面重连）。
 *
 * 被 require 时即完成：DOM 桩 → 装虚拟时钟 → require 生产模块。必须在其它 require 之前引入本文件。
 */

// ---- 浏览器最小桩（必须先于 require 生产模块）----
global.document = {
  getElementById: () => null,
  createElement: () => ({ classList: { add() {}, remove() {}, contains() {} }, style: {}, appendChild() {} }),
  querySelectorAll: () => [],
  addEventListener() {}
};
global.window = {};
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.confirm = () => true;

// ---- 虚拟时钟 ----
const realSetImmediate = setImmediate;
const realDate = Date;
let now = 1791200000000;   // 从“真实纪元”起算，保证 Date.now() 语义与线上一致（seq 纪元等依赖它）
let timerSeq = 0;
const timers = new Map();

global.setTimeout = (fn, delay, ...args) => {
  const id = ++timerSeq;
  timers.set(id, { id, time: now + Math.max(0, delay | 0), fn, args, interval: 0 });
  return id;
};
global.setInterval = (fn, delay, ...args) => {
  const id = ++timerSeq;
  timers.set(id, { id, time: now + Math.max(1, delay | 0), fn, args, interval: Math.max(1, delay | 0) });
  return id;
};
global.clearTimeout = id => { timers.delete(id); };
global.clearInterval = id => { timers.delete(id); };
global.Date = class extends realDate {
  constructor(...a) { if (a.length === 0) super(now); else super(...a); }
  static now() { return now; }
};

// 只需冲刷微任务（本套件的定时器全为虚拟，不依赖事件循环的宏任务）
const flush = () => Promise.resolve();

/** 推进虚拟时间 ms（并按时间顺序执行到期的定时器与消息投递），期间不断冲刷微任务 */
async function advance(ms) {
  const target = now + Math.max(0, ms | 0);
  let guard = 0;
  for (;;) {
    let best = null;
    for (const t of timers.values()) {
      if (t.time <= target && (!best || t.time < best.time || (t.time === best.time && t.id < best.id))) best = t;
    }
    if (!best || guard++ > 20000) break;
    now = Math.max(now, best.time);
    if (best.interval) best.time = now + best.interval; else timers.delete(best.id);
    try { best.fn(...(best.args || [])); } catch (e) { /* 记到调用方 */ }
    await flush();
  }
  now = target;
  await flush();
}
/** 走若干个“极小步”：让消息投递 + 微任务断言收敛 */
async function settle(k = 6) { for (let i = 0; i < k; i++) await advance(1); }

// ---- 生产模块（时钟已就位）----
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

// ---- 内存版 Trystero（可靠有序；带 __drop 掉线钩子）----
function makeMock() {
  const rooms = new Map();
  const byId = new Map();
  let counter = 0;
  const api = {
    selfId: 'global',
    roomCount: () => rooms.size,
    joinRoom(config, roomId) {
      const myId = 'peer' + (++counter);
      const members = rooms.get(roomId) || [];
      rooms.set(roomId, members);
      const entry = { selfId: myId, room: null, actions: new Map(), roomId };
      byId.set(myId, entry);
      const room = {
        selfId: myId,
        makeAction(name) {
          const act = {
            onMessage: null,
            send(data, opts) {
              const target = opts && opts.target;
              setTimeout(() => {
                const ms = rooms.get(roomId) || [];
                for (const m of ms) {
                  if (m === entry) continue;
                  if (target && m.selfId !== target) continue;
                  const a = m.actions.get(name);
                  if (a && typeof a.onMessage === 'function') a.onMessage(data, { peerId: myId });
                }
              }, 0);
            }
          };
          entry.actions.set(name, act);
          return act;
        },
        onPeerJoin: null,
        onPeerLeave: null,
        getPeers() { const o = {}; for (const m of (rooms.get(roomId) || [])) if (m !== entry) o[m.selfId] = true; return o; },
        leave: async () => { api.__drop(myId); }
      };
      entry.room = room;
      const existing = members.slice();
      members.push(entry);
      setTimeout(() => {
        for (const m of existing) if (typeof m.room.onPeerJoin === 'function') m.room.onPeerJoin(myId);
        for (const m of members) if (m !== entry && typeof room.onPeerJoin === 'function') room.onPeerJoin(m.selfId);
      }, 0);
      return room;
    },
    /** 传输层掉线：把该 peer 从房间移除，其余 peer 收到 onPeerLeave（掉线方自己无感知，等价于断网） */
    __drop(id) {
      const e = byId.get(id);
      if (!e) return;
      const ms = rooms.get(e.roomId) || [];
      const i = ms.indexOf(e);
      if (i >= 0) ms.splice(i, 1);
      for (const m of ms) if (typeof m.room.onPeerLeave === 'function') m.room.onPeerLeave(id);
    },
    __online(id) { const e = byId.get(id); return !!e && (rooms.get(e.roomId) || []).includes(e); }
  };
  return api;
}
global.Trystero = makeMock();

// ---- 引擎桩（与 netstress 一致：忠实复刻 resolveAfterMove/onMoveCompleted 的结算口径）----
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
      if (finished || gs.gamePhase === 'finished') this.endGame();
    },
    onMoveCompleted() { this.resolveAfterMove(); },
    notifyKnockout(player, reason) { const s = this._sessionRef && this._sessionRef.current; if (s && s.isHost && s.active) s._broadcastEliminate(player, reason); },
    endGame() { this.isGameActive = false; const s = this._sessionRef && this._sessionRef.current; if (s && s.isHost && s.active) s.onGameEnd(); }
  };
}

function makeRng(seed) { return function () { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function boardSig(gs) {
  let b = '';
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) { const p = gs.board[x][y]; b += p ? (p.type[0] + p.player + (p.facing || '')) : '.'; }
  return b;
}
function sig(session) {
  const gs = session.gameEngine.gameState;
  return boardSig(gs) + '|cp' + gs.currentPlayer + '|t' + gs.turn + '|' + gs.gamePhase + '|' + JSON.stringify(gs.pieceCounts)
    + '|h' + gs.moveHistory.length + '|e' + gs.eliminationOrder.join(',') + '|o' + gs.outOfPlay.join(',') + '|d' + (gs.isDraw ? 1 : 0) + '|w' + gs.winner;
}
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

module.exports = {
  OnlineSession, fakeEngine, makeRng, advance, settle, boardSig, sig, localInv, legalMoves,
  mock: global.Trystero, clockNow: () => now
};
