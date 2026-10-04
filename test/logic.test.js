/**
 * 四人象棋 - 核心规则回归测试（Node，无浏览器）
 * 运行: node test/logic.test.js   或   npm test
 *
 * 覆盖：兵/卒固定朝向与过河规则、将死判定、吃子/悔棋、棋盘可玩性。
 */

// ---- 浏览器最小桩 ----
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

// ---- 迷你断言 ----
let pass = 0, fail = 0;
const failures = [];
function t(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (extra ? '  -> ' + extra : '')); }
}

function makeGame() {
  const gs = new GameState();
  const pm = new PieceManager(gs);
  const rv = new RuleValidator(gs, pm);
  gs.calculatePossibleMoves = (x, y) => rv.getValidMoves(x, y);
  pm.getValidMoves = (x, y) => rv.getValidMoves(x, y);
  return { gs, pm, rv };
}
function emptyBoard(gs) {
  for (let x = 0; x < Config.BOARD_SIZE; x++)
    for (let y = 0; y < Config.BOARD_SIZE; y++) gs.board[x][y] = null;
  gs.pieceCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
}
function put(gs, type, player, x, y, facing) {
  const pc = new ChessPiece(type, player, x, y, facing || null);
  gs.setPiece(x, y, pc); gs.pieceCounts[player] = (gs.pieceCounts[player] || 0) + 1;
  return pc;
}
const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
const PERP = { up: ['left', 'right'], down: ['left', 'right'], left: ['up', 'down'], right: ['up', 'down'] };
const DIRS = ['up', 'down', 'left', 'right'];
// 象限索引：0=红(左下) 1=蓝(右上) 2=绿(右下) 3=黑(左上)
function quad(x, y) { if (x < 5 && y < 5) return 3; if (x >= 5 && y < 5) return 1; if (x >= 5 && y >= 5) return 2; return 0; }

// =====================================================================
// 1. 兵/卒固定朝向：每人 4 兵，恰好 2 管一个邻敌 + 2 管另一个，且朝向指向真正的敌人
// =====================================================================
const EXPECT_FACINGS = { 0: ['up', 'right'], 1: ['left', 'down'], 2: ['up', 'left'], 3: ['down', 'right'] };
for (let p = 0; p < 4; p++) {
  const pawns = Config.INITIAL_POSITIONS[p].filter(q => q.type === 'pawn');
  t(`P${p} 初始兵数=4`, pawns.length === 4);
  const facings = pawns.map(q => q.facing);
  t(`P${p} 每个兵都有 facing`, facings.every(Boolean), JSON.stringify(facings));
  const counts = {};
  facings.forEach(f => counts[f] = (counts[f] || 0) + 1);
  const uniq = Object.keys(counts);
  t(`P${p} 朝向种类=2 且 2/2 分布`, uniq.length === 2 && counts[uniq[0]] === 2 && counts[uniq[1]] === 2, JSON.stringify(counts));
  t(`P${p} 朝向属于期望集合 ${EXPECT_FACINGS[p]}`, facings.every(f => EXPECT_FACINGS[p].includes(f)), JSON.stringify(facings));
  // 沿朝向走出本方象限，落到的是敌人象限
  for (const q of pawns) {
    let x = q.x, y = q.y, guard = 0;
    while (Utils.isInPlayerArea(x, y, p) && guard++ < 20) {
      const nx = CoordinateMapper.getNextPosition(x, y, q.facing, 1);
      if (!Utils.isValidPosition(nx.x, nx.y)) break;
      x = nx.x; y = nx.y;
    }
    const targetQuad = quad(x, y);
    t(`P${p} 兵(${q.x},${q.y}) 朝向 ${q.facing} 指向敌人象限`, Utils.isEnemy(p, targetQuad), `到达象限${targetQuad}`);
  }
}

// =====================================================================
// 2. 未过河只能 1 步；过河后 3 方向 = facing + 两个垂直；永不含反向
// =====================================================================
for (let p = 0; p < 4; p++) {
  const pawns = Config.INITIAL_POSITIONS[p].filter(q => q.type === 'pawn');
  for (const q of pawns) {
    const { gs, rv } = makeGame(); emptyBoard(gs);
    gs.setPiece(q.x, q.y, new ChessPiece('pawn', p, q.x, q.y, q.facing));
    gs.currentPlayer = p; gs.gamePhase = 'playing';
    const moves = rv.getValidMoves(q.x, q.y);
    const want = CoordinateMapper.getNextPosition(q.x, q.y, q.facing, 1);
    t(`P${p} 兵(${q.x},${q.y}) 未过河只能 1 步(沿${q.facing})`,
      moves.length === 1 && moves[0].x === want.x && moves[0].y === want.y,
      JSON.stringify(moves));
  }
}

// =====================================================================
// 3. 过河后：BFS 可达范围内，任何一步都不能是 facing 的反向（不可后退）
// =====================================================================
function reachable(gs, rv, p, sx, sy, facing) {
  const seen = new Set([sx + ',' + sy]);
  const q = [[sx, sy]]; const events = [];
  while (q.length) {
    const [x, y] = q.shift();
    emptyBoard(gs);
    gs.setPiece(x, y, new ChessPiece('pawn', p, x, y, facing));
    gs.currentPlayer = p; gs.gamePhase = 'playing';
    for (const d of DIRS) {
      const nx = x + (d === 'left' ? -1 : d === 'right' ? 1 : 0);
      const ny = y + (d === 'up' ? -1 : d === 'down' ? 1 : 0);
      if (!Utils.isValidPosition(nx, ny)) continue;
      if (!rv.isValidMove(x, y, nx, ny)) continue;
      events.push({ d, from: [x, y] });
      const k = nx + ',' + ny;
      if (!seen.has(k)) { seen.add(k); q.push([nx, ny]); }
    }
  }
  return { cells: seen, events };
}
let backwardTotal = 0;
for (let p = 0; p < 4; p++) {
  const pawns = Config.INITIAL_POSITIONS[p].filter(q => q.type === 'pawn');
  for (const q of pawns) {
    const { gs, rv } = makeGame();
    const { events } = reachable(gs, rv, p, q.x, q.y, q.facing);
    const back = events.filter(e => e.d === OPP[q.facing]);
    backwardTotal += back.length;
    t(`P${p} 兵(${q.x},${q.y}) 朝向${q.facing} 无后退走法`, back.length === 0,
      back.length ? `可在 ${back[0].from} 向 ${back[0].d} 走` : '');
  }
}
t('全部兵/卒均可后退走法总数为 0', backwardTotal === 0, 'count=' + backwardTotal);

// =====================================================================
// 4. 将死判定：可垫将/可逃 不能判为将死；真正无解才判将死；且不破坏坐标
// =====================================================================
// 4a. 黑将被两车照两列，仅剩"垫将"一条路 -> 不应判将死
{
  const { gs, pm, rv } = makeGame(); emptyBoard(gs);
  const bk = put(gs, 'king', 3, 0, 0);
  put(gs, 'king', 0, 4, 9);
  put(gs, 'rook', 0, 0, 9);
  put(gs, 'rook', 0, 1, 9);
  const br = put(gs, 'rook', 3, 3, 1); // 可走到(0,1)/(1,1)垫将
  gs.currentPlayer = 3; gs.gamePhase = 'playing';
  const blockLegal = rv.isValidMove(3, 1, 0, 1) || rv.isValidMove(3, 1, 1, 1);
  t('垫将走法本身合法', blockLegal);
  t('可垫将解将 => 不是将死', pm.isCheckmate(3) === false);
  t('isCheckmate 后黑将坐标未被污染', bk.x === 0 && bk.y === 0, `${bk.x},${bk.y}`);
  t('isCheckmate 后仍正确判定被将军', pm.isInCheck(3) === true);
  t('isCheckmate 后红车仍在原位', !!gs.getPiece(3, 1) && gs.getPiece(3, 1).player === 3);
}
// 4b. 真正的将死：黑将(0,0)，红车照(0,y)与(1,y)两列，红车还照(2,0)行口，黑无子可动
{
  const { gs, pm } = makeGame(); emptyBoard(gs);
  put(gs, 'king', 3, 0, 0);
  put(gs, 'king', 0, 4, 9);
  put(gs, 'rook', 0, 0, 5);  // 照 x=0 列
  put(gs, 'rook', 0, 1, 5);  // 照 x=1 列
  put(gs, 'rook', 0, 2, 0);  // 照 y=0 行（封住(2,0)？将不能走(2,0)，且(0,1)(1,0)被列照）
  gs.currentPlayer = 3; gs.gamePhase = 'playing';
  t('构造局面：黑确实被将军', pm.isInCheck(3) === true);
  // 黑将(0,0) 逃格：(1,0)被x=1车照，(0,1)被x=0车照 -> 无路，且无其它黑子 => 将死
  t('无解局面 => 判为将死', pm.isCheckmate(3) === true);
}
// 4c. 将可逃则不是将死
{
  const { gs, pm } = makeGame(); emptyBoard(gs);
  put(gs, 'king', 3, 0, 0);
  put(gs, 'king', 0, 4, 9);
  put(gs, 'rook', 0, 0, 5); // 只照 x=0
  gs.currentPlayer = 3; gs.gamePhase = 'playing';
  t('只有一列被照 => 将可逃到(1,0) => 不是将死', pm.isCheckmate(3) === false);
}

// =====================================================================
// 5. 吃子 + 悔棋 还原（回归）
// =====================================================================
{
  const { gs, rv } = makeGame(); emptyBoard(gs);
  put(gs, 'king', 0, 0, 9); put(gs, 'king', 2, 9, 9);
  put(gs, 'rook', 0, 0, 8); put(gs, 'horse', 2, 0, 5);
  gs.currentPlayer = 0; gs.gamePhase = 'playing';
  const before = JSON.stringify(gs.board.map(c => c.map(p => p ? p.type + p.player : null)));
  const cnt = gs.pieceCounts[2];
  t('车吃敌子合法', rv.isValidMove(0, 8, 0, 5) === true);
  gs.movePiece(0, 8, 0, 5);
  t('吃子后敌子计数-1', gs.pieceCounts[2] === cnt - 1);
  gs.undoMove();
  const after = JSON.stringify(gs.board.map(c => c.map(p => p ? p.type + p.player : null)));
  t('悔棋后棋盘还原', before === after);
  t('悔棋后计数还原', gs.pieceCounts[2] === cnt);
  t('悔棋后轮到原玩家', gs.currentPlayer === 0);
}

// =====================================================================
// 6. 初始局面可玩：红方有合法走法；无玩家一开始就被将军
// =====================================================================
{
  const { gs, pm, rv } = makeGame();
  gs.gamePhase = 'playing'; gs.currentPlayer = 0;
  let redMoves = 0;
  for (let x = 0; x < Config.BOARD_SIZE; x++) for (let y = 0; y < Config.BOARD_SIZE; y++) {
    const pc = gs.getPiece(x, y);
    if (pc && pc.player === 0) redMoves += rv.getValidMoves(x, y).length;
  }
  t('开局红方有合法走法', redMoves > 0, 'moves=' + redMoves);
  t('开局无人被将军', [0, 1, 2, 3].every(p => pm.isInCheck(p) === false));
}

// ---- 汇总 ----
console.log(`\n规则回归测试: ${pass} 通过, ${fail} 失败`);
if (fail) { console.log('\n失败项:'); failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('✅ 全部通过');
