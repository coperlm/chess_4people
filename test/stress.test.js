/**
 * 四人象棋 - 大规模随机对局压力测试（数万手）
 * 运行: node test/stress.test.js
 *
 * 目的：随机"乱走"数万手，逐步校验逻辑是否自洽：
 *  1. 每一步都合法（路径/吃子/朝向等）；本变体允许“走完会被将军”的走法，不算错；
 *  2. 棋盘与坐标、棋子计数始终一致；
 *  3. 被淘汰者必定 0 子且已进 eliminationOrder，存活者必不在 eliminationOrder；
 *  4. 将被吃 / 困毙 一定被结算（不会出现"无子可动却还轮到它"的死锁）；
 *  5. 对局要么正常结束，要么在有限手内被判为未结束（不会无限卡死）。
 */

global.document = {
  getElementById: () => null,
  createElement: () => ({ classList: { add() {}, remove() {}, contains() {} }, style: {}, appendChild() {} }),
  addEventListener() {}
};
global.window = { addEventListener() {} };
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

const RULE_SETS = [
  { mode: 'team', victory: 'any_king', friendlyFire: false },
  { mode: 'team', victory: 'last_team', friendlyFire: false },
  { mode: 'team', victory: 'last_team', friendlyFire: true },
  { mode: 'ffa', victory: 'last_team', friendlyFire: false }
];

// 确定性 PRNG（mulberry32），保证可复现
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGame(rules) {
  const gs = new GameState();
  gs.setRules(rules);
  const pm = new PieceManager(gs);
  const rv = new RuleValidator(gs, pm);
  gs.ruleValidator = rv;
  pm.ruleValidator = rv;
  return { gs, pm, rv };
}

/** 返回棋盘自洽性错误描述，或 null */
function consistencyError(gs) {
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (let x = 0; x < Config.BOARD_SIZE; x++) {
    for (let y = 0; y < Config.BOARD_SIZE; y++) {
      const pc = gs.board[x][y];
      if (!pc) continue;
      if (pc.x !== x || pc.y !== y) return `坐标漂移: (${x},${y}) 上是 ${pc.type} 但 x/y=${pc.x},${pc.y}`;
      if (pc.player < 0 || pc.player > 3) return `非法玩家号 ${pc.player}`;
      counts[pc.player]++;
    }
  }
  for (let p = 0; p < 4; p++) {
    if (counts[p] !== gs.pieceCounts[p]) return `计数不符 p${p}: 棋盘${counts[p]} vs 计数${gs.pieceCounts[p]}`;
    const eliminated = gs.eliminationOrder.includes(p);
    if (eliminated && counts[p] !== 0) return `已淘汰 p${p} 仍有 ${counts[p]} 子`;
    if (!eliminated && !gs.hasKing(p)) return `存活 p${p} 却无将`;
    if (!eliminated && gs.hasKing(p) && counts[p] === 0) return `p${p} 有将但 0 子`;
  }
  return null;
}

/** 与 GameEngine.resolveAfterMove 同逻辑：将被吃一律出局；困毙只在“轮到该方”时判（可连锁） */
function resolve(gs, rv, koStats) {
  for (let guard = 0; guard < 8 && gs.gamePhase === 'playing'; guard++) {
    for (let p = 0; p < 4; p++) {
      if (!gs.hasKing(p) && !gs.eliminationOrder.includes(p) && !gs.outOfPlay.includes(p)) { gs.eliminatePlayer(p); koStats.captured++; }
    }
    if (gs.checkGameEnd()) return true;
    if (!gs.hasKing(gs.currentPlayer)) { gs.nextPlayer(); continue; }
    const cur = gs.currentPlayer;
    if (!gs.currentPlayerStuck(rv)) return false;
    koStats.stalemate++;
    gs.eliminatePlayer(cur);
    if (gs.checkGameEnd()) return true;
    gs.nextPlayer();
  }
  return gs.gamePhase === 'finished';
}

function playGame(rng, rules, maxPlies) {
  const { gs, rv } = makeGame(rules);
  gs.startGame();
  let plies = 0;
  let error = null;
  let selfCheckMoves = 0;
  const koStats = { stalemate: 0, captured: 0 };

  while (gs.gamePhase === 'playing' && plies < maxPlies) {
    if (resolve(gs, rv, koStats)) break;

    // 枚举当前玩家的全部走法（含“走完会被将军”的走法——本变体允许）
    const p = gs.currentPlayer;
    const moves = [];
    for (let x = 0; x < Config.BOARD_SIZE; x++) {
      for (let y = 0; y < Config.BOARD_SIZE; y++) {
        const pc = gs.getPiece(x, y);
        if (pc && pc.player === p) for (const mv of rv.getValidMoves(x, y)) moves.push({ x, y, tx: mv.x, ty: mv.y });
      }
    }
    // 存活且轮到它，却一步都不能走 => 结算漏网（逻辑 bug）
    if (moves.length === 0) { error = `p${p} 轮到却无子可动（未被结算）`; break; }

    const pick = moves[Math.floor(rng() * moves.length)];
    if (rv.wouldBeInCheckAfterMove(pick.x, pick.y, pick.tx, pick.ty, p)) selfCheckMoves++;
    if (!gs.movePiece(pick.x, pick.y, pick.tx, pick.ty)) { error = 'movePiece 返回 false'; break; }
    plies++;

    // 走子后先结算（将被吃 / 困毙），再校验自洽
    resolve(gs, rv, koStats);
    const cErr = consistencyError(gs);
    if (cErr) { error = cErr; break; }
    if (gs.gamePhase !== 'playing') break;
  }

  return { plies, finished: gs.gamePhase === 'finished', error, koStats, selfCheckMoves, winner: gs.winner };
}

// =====================================================================
const TARGET_PLIES = 60000;   // 目标手数（"几万步"）
const MAX_GAMES = 400;
const MAX_PLIES_PER_GAME = 800;

const rng = mulberry32(20261005);
let totalPlies = 0, games = 0, finishedGames = 0, unfinishedGames = 0;
let koStale = 0, koCaptured = 0, selfChecks = 0;
const errors = [];

while (totalPlies < TARGET_PLIES && games < MAX_GAMES) {
  const rules = RULE_SETS[Math.floor(rng() * RULE_SETS.length)];
  const r = playGame(rng, rules, MAX_PLIES_PER_GAME);
  games++; totalPlies += r.plies;
  if (r.finished) finishedGames++; else unfinishedGames++;
  koStale += r.koStats.stalemate; koCaptured += r.koStats.captured; selfChecks += r.selfCheckMoves;
  if (r.error) { errors.push(`局#${games} ${JSON.stringify(rules)}: ${r.error}`); if (errors.length >= 10) break; }
}

let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) pass++; else { fail++; errors.push(name + (extra ? '  -> ' + extra : '')); } };

t('随机对局数万手：无任何自洽性/合法性错误', errors.length === 0, errors.slice(0, 6).join(' | '));
t('无"轮到却无子可动"的死锁', !errors.some(e => e.includes('无子可动')));
t(`累计手数达到几万步（实际 ${totalPlies}）`, totalPlies >= TARGET_PLIES, 'plies=' + totalPlies);

console.log(`\n随机压力测试: ${pass} 通过, ${fail} 失败`);
console.log(`共 ${games} 局 / ${totalPlies} 手；正常结束 ${finishedGames} 局，未分胜负(达上限) ${unfinishedGames} 局`);
console.log(`结算事件：困毙 ${koStale} 次，将/帅被吃 ${koCaptured} 次；其中“走完仍被将军”的自选走法 ${selfChecks} 次`);
if (fail) { console.log('\n失败项:'); errors.forEach(e => console.log('  ✗ ' + e)); process.exit(1); }
console.log('✅ 全部通过');
