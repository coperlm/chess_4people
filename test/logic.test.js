/**
 * 四人象棋 - 核心规则回归测试（Node，无浏览器）
 * 运行: node test/logic.test.js   或   npm test
 *
 * 覆盖：兵/卒固定朝向与过河规则、将军语义（不强制应对/困毙/吃将出局）、吃子/悔棋、棋盘可玩性。
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
global.Notation = require(path.join(ROOT, 'js/ui/Notation.js'));

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
  gs.ruleValidator = rv;
  pm.ruleValidator = rv;
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
    const isEnemyQuad = p !== targetQuad && Config.TEAMS.TEAM1.includes(p) !== Config.TEAMS.TEAM1.includes(targetQuad);
    t(`P${p} 兵(${q.x},${q.y}) 朝向 ${q.facing} 指向敌人象限`, isEnemyQuad, `到达象限${targetQuad}`);
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
// 4. 将军语义：本变体“将军不强制应对”——被将军仍可走子；
//    只有「将/帅被吃」或「困毙（完全无子可动）」才出局（无“将死自动出局”）
// =====================================================================
// 4a. 被将军时仍可走“与解将无关”的棋子（旧规则会禁止）；但会触发弹窗条件
{
  const { gs, pm, rv } = makeGame(); emptyBoard(gs);
  put(gs, 'king', 3, 0, 0);   // 黑将
  put(gs, 'king', 0, 0, 9);   // 红帅
  put(gs, 'rook', 0, 0, 5);   // 红车照 x=0 列 => 黑被将军
  put(gs, 'rook', 3, 3, 1);   // 黑车（与解将无关）
  gs.currentPlayer = 3; gs.gamePhase = 'playing';
  t('构造：黑确实被将军', pm.isInCheck(3) === true);
  t('被将军时允许走无关棋子（新规则）', rv.isValidMove(3, 1, 4, 1) === true);
  t('该走法走完仍被将军 => 触发弹窗条件', rv.wouldBeInCheckAfterMove(3, 1, 4, 1, 3) === true);
  t('被将军但仍有子可走 => 不算困毙、不被出局', !gs.computeKnockouts(rv).some(k => k.player === 3));
}
// 4b. 能解将的走法：不触发弹窗（wouldBeInCheckAfterMove=false）
{
  const { gs, rv } = makeGame(); emptyBoard(gs);
  put(gs, 'king', 3, 0, 0);
  put(gs, 'king', 0, 0, 9);
  put(gs, 'rook', 0, 0, 5);   // 照 x=0 列
  put(gs, 'rook', 3, 3, 1);   // 黑车可垫到 (0,1) 解将
  gs.currentPlayer = 3; gs.gamePhase = 'playing';
  t('垫将走法合法', rv.isValidMove(3, 1, 0, 1) === true);
  t('解将走法不触发弹窗', rv.wouldBeInCheckAfterMove(3, 1, 0, 1, 3) === false);
}
// 4c. 困毙（完全无子可动）=> 结算为 stalemate（唯一会“自动出局”的情形，兜底）
{
  const { gs, pm, rv } = makeGame(); emptyBoard(gs);
  put(gs, 'king', 3, 0, 0);      // 黑将
  put(gs, 'advisor', 3, 1, 0);   // 四个士互相堵死，也堵死将的两个逃格
  put(gs, 'advisor', 3, 0, 1);
  put(gs, 'advisor', 3, 2, 1);
  put(gs, 'advisor', 3, 1, 2);
  put(gs, 'king', 0, 0, 9);      // 红帅（x=0 列被 (0,1) 的士挡住，不将军）
  gs.currentPlayer = 3; gs.gamePhase = 'playing';
  t('困毙局面：黑未被将军', pm.isInCheck(3) === false);
  const k = gs.computeKnockouts(rv);
  t('困毙 => 结算原因为 stalemate', k.length === 1 && k[0].player === 3 && k[0].reason === 'stalemate', JSON.stringify(k));
}
// 4d. 将/帅被“直接吃掉”：该玩家须彻底出局、残子清空
//     （否则会出现“无将却有残子在场”的不一致状态）
{
  const { gs, rv } = makeGame(); emptyBoard(gs);
  put(gs, 'king', 0, 0, 9);  // 红帅
  put(gs, 'rook', 0, 0, 5);  // 红车：可沿 x=0 直取黑将
  put(gs, 'king', 3, 0, 0);  // 黑将（已在红车射程内）
  put(gs, 'rook', 3, 1, 3);  // 黑方残子（不在 x=0 列上，避免挡车）
  gs.currentPlayer = 0; gs.gamePhase = 'playing';
  t('吃将走法本身合法', rv.isValidMove(0, 5, 0, 0) === true);
  gs.movePiece(0, 5, 0, 0);
  t('黑将已被吃、红车就位', !gs.hasKing(3) && !!gs.getPiece(0, 0) && gs.getPiece(0, 0).player === 0);
  t('此时黑方残子仍在场上（待结算）', !!gs.getPiece(1, 3));
  const ended = gs.checkGameEnd();
  t('黑方被彻底出局：残子清空、计数归零', gs.getPiece(1, 3) === null && gs.pieceCounts[3] === 0);
  t('黑方进入出局名单', gs.eliminationOrder.includes(3));
  t('吃将触发终局（默认吃将即结束）', ended === true && gs.gamePhase === 'finished');
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

// =====================================================================
// 7. 房间规则：友伤 / 模式(组队·混战) / 胜利条件 / 排名
// =====================================================================
{
  const { gs, rv } = makeGame(); emptyBoard(gs);
  gs.setRules({ mode: 'team', victory: 'any_king', friendlyFire: false });
  put(gs, 'king', 0, 0, 9); put(gs, 'king', 1, 9, 0); put(gs, 'king', 2, 9, 9); put(gs, 'king', 3, 0, 0);
  put(gs, 'rook', 0, 0, 5);
  put(gs, 'pawn', 1, 0, 6); // 蓝方是红方队友
  gs.currentPlayer = 0; gs.gamePhase = 'playing';
  t('友伤关：不能吃队友棋子', rv.isValidMove(0, 5, 0, 6) === false);
  gs.setRules({ mode: 'team', victory: 'any_king', friendlyFire: true });
  t('友伤开：可以吃队友棋子', rv.isValidMove(0, 5, 0, 6) === true);
}
{
  const { gs } = makeGame(); emptyBoard(gs);
  gs.setRules({ mode: 'ffa' });
  t('FFA: 胜利条件被强制为 last_team', gs.rules.victory === 'last_team');
  put(gs, 'king', 0, 0, 9); put(gs, 'king', 1, 9, 0); put(gs, 'king', 2, 9, 9); put(gs, 'king', 3, 0, 0);
  t('FFA: 0 与 1 不是队友', gs.isTeammate(0, 1) === false);
  t('FFA: 0 与 1 互为敌人', gs.isEnemy(0, 1) === true);
  gs.eliminatePlayer(3); t('FFA: 淘汰 3 后未结束', gs.checkGameEnd() === false);
  gs.eliminatePlayer(1); t('FFA: 淘汰 1 后未结束', gs.checkGameEnd() === false);
  gs.eliminatePlayer(2); t('FFA: 只剩 0 -> 结束且 0 获胜', gs.checkGameEnd() === true && gs.winner === 0);
  t('FFA: 排名=[0,2,1,3]（存活者在前，按死亡逆序）', JSON.stringify(gs.ranking) === JSON.stringify([0, 2, 1, 3]), JSON.stringify(gs.ranking));
}
{
  const { gs } = makeGame(); emptyBoard(gs);
  gs.setRules({ mode: 'team', victory: 'last_team' });
  put(gs, 'king', 0, 0, 9); put(gs, 'king', 1, 9, 0); put(gs, 'king', 2, 9, 9); put(gs, 'king', 3, 0, 0);
  gs.eliminatePlayer(0); t('last_team: 红出局但蓝还在 -> 未结束', gs.checkGameEnd() === false);
  gs.eliminatePlayer(1); t('last_team: 红蓝全灭 -> 绿黑获胜', gs.checkGameEnd() === true && gs.winner === 'TEAM2');
}
{
  const { gs } = makeGame(); emptyBoard(gs);
  gs.setRules({ mode: 'team', victory: 'any_king' });
  put(gs, 'king', 0, 0, 9); put(gs, 'king', 1, 9, 0); put(gs, 'king', 2, 9, 9); put(gs, 'king', 3, 0, 0);
  gs.eliminatePlayer(2); t('any_king: 淘汰绿 -> 红蓝获胜并结束', gs.checkGameEnd() === true && gs.winner === 'TEAM1');
}
{
  const { gs } = makeGame(); emptyBoard(gs);
  put(gs, 'king', 0, 0, 9); put(gs, 'king', 1, 9, 0); put(gs, 'king', 2, 9, 9); put(gs, 'king', 3, 0, 0);
  gs.eliminatePlayer(2); // 绿被淘汰
  gs.currentPlayer = 0;
  gs.nextPlayer();
  t('nextPlayer 跳过被淘汰的绿(2)', gs.currentPlayer === 1, 'got ' + gs.currentPlayer);
}

// =====================================================================
// 8. 棋子命名：成套、不混搭（红蓝同款 / 绿黑同款）
// =====================================================================
{
  const isSetA = n => n.king === '帅' && n.advisor === '士' && n.elephant === '相' && n.pawn === '兵';
  const isSetB = n => n.king === '将' && n.advisor === '仕' && n.elephant === '象' && n.pawn === '卒';
  for (const p of [0, 1, 2, 3]) {
    const n = Config.PIECE_NAMES[p];
    t(`P${p} 棋子命名成套不混搭`, isSetA(n) || isSetB(n), `${n.king}${n.advisor}${n.elephant}${n.pawn}`);
  }
  t('红蓝命名同款', Config.PIECE_NAMES[0].king === Config.PIECE_NAMES[1].king && Config.PIECE_NAMES[0].pawn === Config.PIECE_NAMES[1].pawn);
  t('绿黑命名同款', Config.PIECE_NAMES[2].king === Config.PIECE_NAMES[3].king && Config.PIECE_NAMES[2].pawn === Config.PIECE_NAMES[3].pawn);
  t('蓝方将=帅', Config.PIECE_NAMES[1].king === '帅', Config.PIECE_NAMES[1].king);
}

// =====================================================================
// 9. 记谱（坐标/中文）+ 悔棋单独记录 + 和棋
// =====================================================================
{
  const mv = { player: 0, piece: 'rook', from: { x: 9, y: 5 }, to: { x: 9, y: 2 }, captured: null };
  t('坐标记谱', Notation.format(mv, 'coord') === '红方 车 (9,5)→(9,2)', Notation.format(mv, 'coord'));
  t('中文记谱', Notation.format(mv, 'cn') === '红方 车 (九,五)→(九,二)', Notation.format(mv, 'cn'));
  const cap = { player: 0, piece: 'rook', from: { x: 9, y: 5 }, to: { x: 9, y: 2 }, captured: { player: 2, type: 'pawn' } };
  t('中文记谱含吃子', Notation.format(cap, 'cn').includes('吃绿方卒'), Notation.format(cap, 'cn'));
  t('坐标记谱含吃子', Notation.format(cap, 'coord').includes('吃绿方卒'), Notation.format(cap, 'coord'));

  const { gs } = makeGame(); gs.gamePhase = 'playing'; gs.currentPlayer = 0;
  gs.movePiece(0, 6, 0, 5);
  t('走子后历史 1 条、悔棋记录 0 条', gs.moveHistory.length === 1 && gs.undoLog.length === 0);
  gs.undoMove();
  t('悔棋写入 undoLog（单独记录）', gs.undoLog.length === 1 && gs.undoLog[0].player === 0 && gs.undoLog[0].piece === 'pawn', JSON.stringify(gs.undoLog));
  t('悔棋后 moveHistory 清空', gs.moveHistory.length === 0);

  gs.declareDraw();
  t('和棋：finished + isDraw + 无 winner', gs.gamePhase === 'finished' && gs.isDraw === true && gs.winner === null);
}

// ---- 汇总 ----
console.log(`\n规则回归测试: ${pass} 通过, ${fail} 失败`);
if (fail) { console.log('\n失败项:'); failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('✅ 全部通过');
