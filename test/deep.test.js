/**
 * 深度/随机化测试：大量随机对局的不变量校验
 * 运行: node test/deep.test.js
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

let pass = 0, fail = 0; const failures = [];
function t(name, cond, extra) { if (cond) pass++; else { fail++; if (failures.length < 25) failures.push(name + (extra ? '  -> ' + extra : '')); } }
function makeGame(rules) {
  const gs = new GameState();
  if (rules) gs.setRules(rules);
  const pm = new PieceManager(gs);
  const rv = new RuleValidator(gs, pm);
  gs.ruleValidator = rv;
  pm.ruleValidator = rv;
  return { gs, pm, rv };
}
const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
function emptyBoard(gs) { for (let x = 0; x < Config.BOARD_SIZE; x++) for (let y = 0; y < Config.BOARD_SIZE; y++) gs.board[x][y] = null; gs.pieceCounts = { 0: 0, 1: 0, 2: 0, 3: 0 }; }
function dirOf(fx, fy, tx, ty) {
  const dx = tx - fx, dy = ty - fy;
  if (dx === 0 && dy < 0) return 'up';
  if (dx === 0 && dy > 0) return 'down';
  if (dy === 0 && dx < 0) return 'left';
  if (dy === 0 && dx > 0) return 'right';
  return 'diag';
}
function boardHash(gs) {
  let s = '';
  for (let x = 0; x < Config.BOARD_SIZE; x++) for (let y = 0; y < Config.BOARD_SIZE; y++) {
    const p = gs.board[x][y];
    s += p ? `${p.type[0]}${p.player}${p.facing || ''}` : '.';
    s += ',';
  }
  return s + '|cp' + gs.currentPlayer + '|' + JSON.stringify(gs.pieceCounts);
}
function checkBoardConsistency(gs) {  const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (let x = 0; x < Config.BOARD_SIZE; x++) for (let y = 0; y < Config.BOARD_SIZE; y++) {
    const p = gs.board[x][y];
    if (!p) continue;
    counts[p.player]++;
    if (p.x !== x || p.y !== y) return `piece coord mismatch at (${x},${y}) -> (${p.x},${p.y})`;
  }
  for (const k of [0, 1, 2, 3]) if (counts[k] !== gs.pieceCounts[k]) return `count mismatch P${k}: board ${counts[k]} vs ${gs.pieceCounts[k]}`;
  return null;
}

// ============ 1. 随机对局不变量（多模式、数十局、上千手） ============
const MODES = [
  { mode: 'team', victory: 'any_king', friendlyFire: false },
  { mode: 'team', victory: 'any_king', friendlyFire: true },
  { mode: 'team', victory: 'last_team', friendlyFire: false },
  { mode: 'ffa', victory: 'last_team', friendlyFire: false }
];
let totalPlies = 0, games = 0, finishedGames = 0, pawnChecks = 0, mateChecks = 0;
for (let g = 0; g < 40; g++) {
  const rules = MODES[g % MODES.length];
  const { gs, pm, rv } = makeGame(rules);
  gs.gamePhase = 'playing';
  games++;
  for (let ply = 0; ply < 200; ply++) {
    const p = gs.currentPlayer;
    // 收集当前玩家所有合法走法
    const all = [];
    for (let x = 0; x < Config.BOARD_SIZE; x++) for (let y = 0; y < Config.BOARD_SIZE; y++) {
      const pc = gs.board[x][y];
      if (pc && pc.player === p) for (const mv of rv.getValidMoves(x, y)) all.push({ x, y, mv, pc });
    }
    t('当前玩家始终有将', gs.hasKing(p), `game ${g} ply ${ply}`);
    if (!all.length) break; // 无棋可走
    const chosen = all[Math.floor(Math.random() * all.length)];
    // 记录走前 hash（用于 undo 校验）
    const beforeHash = boardHash(gs);
    // 走子合法性：目标不能是己方/队友(无友伤)/越界
    const target = gs.getPiece(chosen.mv.x, chosen.mv.y);
    if (target) t('不会吃己方/队友(无友伤)', !(chosen.pc.player === target.player) && (gs.isEnemy(chosen.pc.player, target.player) || gs.rules.friendlyFire), JSON.stringify(rules));
    // 兵卒朝向
    if (chosen.pc.type === 'pawn') {
      pawnChecks++;
      const d = dirOf(chosen.x, chosen.y, chosen.mv.x, chosen.mv.y);
      t('兵卒不后退', d !== OPP[chosen.pc.facing], JSON.stringify({ from: [chosen.x, chosen.y], to: [chosen.mv.x, chosen.mv.y], facing: chosen.pc.facing }));
      t('兵卒方向合法', d === chosen.pc.facing || (CoordinateMapper.isPawnCrossedRiver(chosen.x, chosen.y, chosen.pc.player) && d !== 'diag'), '');
    }
    gs.movePiece(chosen.x, chosen.y, chosen.mv.x, chosen.mv.y);
    totalPlies++;
    // 一致性
    const err = checkBoardConsistency(gs);
    t('棋盘与坐标/计数一致', err === null, err);
    // 将军不再强制应对：被将军的玩家不会因此出局（只有被吃将/困毙才出局）
    const np = gs.currentPlayer;
    if (pm.isInCheck(np)) {
      mateChecks++;
      t('被将军不导致出局（新规则）', !gs.eliminationOrder.includes(np));
    }
    // undo 还原
    gs.undoMove();
    t('悔棋精确还原', boardHash(gs) === beforeHash);
    // 重新走同一步继续
    gs.movePiece(chosen.x, chosen.y, chosen.mv.x, chosen.mv.y);
    if (gs.checkGameEnd()) { finishedGames++; break; }
  }
}

// ============ 2. 车/炮 路径逻辑与参考实现比对 ============
function referenceRook(gs, fx, fy, tx, ty) {
  if (!Utils.isInLine(fx, fy, tx, ty) || (fx === tx && fy === ty)) return false;
  const path = Utils.getPathBetween(fx, fy, tx, ty);
  return path.every(pos => gs.getPiece(pos.x, pos.y) === null);
}
function referenceCannon(gs, fx, fy, tx, ty) {
  if (!Utils.isInLine(fx, fy, tx, ty) || (fx === tx && fy === ty)) return false;
  const path = Utils.getPathBetween(fx, fy, tx, ty);
  const obstacles = path.filter(pos => gs.getPiece(pos.x, pos.y) !== null).length;
  const target = gs.getPiece(tx, ty);
  return target ? obstacles === 1 : obstacles === 0;
}
let pathChecks = 0;
for (let i = 0; i < 300; i++) {
  const { gs, rv } = makeGame();
  // 随机撒一些非将棋子
  for (let n = 0; n < 12; n++) {
    const x = Math.floor(Math.random() * 10), y = Math.floor(Math.random() * 10);
    const type = ['rook', 'cannon', 'pawn', 'horse'][Math.floor(Math.random() * 4)];
    if (!gs.getPiece(x, y)) gs.board[x][y] = new ChessPiece(type, n % 4, x, y, 'up');
  }
  for (let fx = 0; fx < 10; fx++) for (let fy = 0; fy < 10; fy++) {
    const pc = gs.board[fx][fy];
    if (!pc) continue;
    for (let tx = 0; tx < 10; tx++) for (let ty = 0; ty < 10; ty++) {
      if (tx === fx && ty === fy) continue;
      if (pc.type === 'rook') { pathChecks++; t('车 路径规则一致', rv.validateRookMove(fx, fy, tx, ty) === referenceRook(gs, fx, fy, tx, ty)); }
      else if (pc.type === 'cannon') { pathChecks++; t('炮 路径规则一致', rv.validateCannonMove(fx, fy, tx, ty) === referenceCannon(gs, fx, fy, tx, ty)); }
    }
  }
}

// ============ 2b. 马/象/士/将/兵 的“独立参考实现”差分校验 ============
// 参考实现只用 Config 的区域表 + 自己写的方向向量推导，**刻意不复用** Utils/CoordinateMapper，
// 这样与 RuleValidator 是两条独立路径，才真正起到差分测试（differential testing）的作用。
const refInArea = (x, y, p) => { const a = Config.PLAYABLE_AREAS[p]; return x >= a.x[0] && x <= a.x[1] && y >= a.y[0] && y <= a.y[1]; };
const refInPalace = (x, y, p) => { const a = Config.PALACE_AREAS[p]; return x >= a.x[0] && x <= a.x[1] && y >= a.y[0] && y <= a.y[1]; };
const refOccupied = (gs, x, y) => x >= 0 && x < 10 && y >= 0 && y < 10 && gs.getPiece(x, y) !== null;

function referenceHorse(gs, fx, fy, tx, ty) {
  const dx = tx - fx, dy = ty - fy, ax = Math.abs(dx), ay = Math.abs(dy);
  if (!((ax === 2 && ay === 1) || (ax === 1 && ay === 2))) return false;
  const legX = ax === 2 ? fx + dx / 2 : fx;   // 马腿：沿走两格的那个方向、紧邻出发点的格
  const legY = ay === 2 ? fy + dy / 2 : fy;
  return !refOccupied(gs, legX, legY);
}
function referenceElephant(gs, fx, fy, tx, ty, p) {
  if (!refInArea(tx, ty, p)) return false;                       // 不过河（目标须在本方象限）
  const dx = tx - fx, dy = ty - fy;
  if (Math.abs(dx) !== 2 || Math.abs(dy) !== 2) return false;    // 走田
  return !refOccupied(gs, fx + dx / 2, fy + dy / 2);             // 象眼
}
const referenceAdvisor = (fx, fy, tx, ty, p) => refInPalace(tx, ty, p) && Math.abs(tx - fx) === 1 && Math.abs(ty - fy) === 1;
const referenceKing = (fx, fy, tx, ty, p) => refInPalace(tx, ty, p) && (Math.abs(tx - fx) + Math.abs(ty - fy)) === 1;
const REF_STEP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
function referencePawn(fx, fy, tx, ty, p, facing) {
  const step = REF_STEP[facing];
  if (!step) return false;
  const side = (facing === 'left' || facing === 'right') ? [REF_STEP.up, REF_STEP.down] : [REF_STEP.left, REF_STEP.right];
  const dirs = refInArea(fx, fy, p) ? [step] : [step, ...side];   // 过河(离开本方象限)后才可横走
  return dirs.some(d => fx + d[0] === tx && fy + d[1] === ty);
}

let diffChecks = 0;
for (let i = 0; i < 150; i++) {
  const { gs, rv } = makeGame();
  for (let n = 0; n < 15; n++) {
    const x = Math.floor(Math.random() * 10), y = Math.floor(Math.random() * 10);
    const type = ['horse', 'elephant', 'advisor', 'king', 'pawn'][n % 5];
    const player = n % 4;
    const facing = ['up', 'down', 'left', 'right'][n % 4];
    if (!gs.getPiece(x, y)) gs.board[x][y] = new ChessPiece(type, player, x, y, facing);
  }
  for (let fx = 0; fx < 10; fx++) for (let fy = 0; fy < 10; fy++) {
    const pc = gs.board[fx][fy];
    if (!pc) continue;
    for (let tx = 0; tx < 10; tx++) for (let ty = 0; ty < 10; ty++) {
      if (tx === fx && ty === fy) continue;
      let mine, ref;
      if (pc.type === 'horse') { mine = rv.validateHorseMove(fx, fy, tx, ty); ref = referenceHorse(gs, fx, fy, tx, ty); }
      else if (pc.type === 'elephant') { mine = rv.validateElephantMove(fx, fy, tx, ty, pc.player); ref = referenceElephant(gs, fx, fy, tx, ty, pc.player); }
      else if (pc.type === 'advisor') { mine = rv.validateAdvisorMove(fx, fy, tx, ty, pc.player); ref = referenceAdvisor(fx, fy, tx, ty, pc.player); }
      else if (pc.type === 'king') { mine = rv.validateKingMove(fx, fy, tx, ty, pc.player); ref = referenceKing(fx, fy, tx, ty, pc.player); }
      else if (pc.type === 'pawn') { mine = rv.validatePawnMove(pc, fx, fy, tx, ty); ref = referencePawn(fx, fy, tx, ty, pc.player, pc.facing); }
      else continue;
      diffChecks++;
      t(pc.type + ' 与参考实现一致', mine === ref, `${fx},${fy}->${tx},${ty} P${pc.player}`);
    }
  }
}

// ============ 2c. 士/将/兵 的确定性边界（补上差分测试不易随机命中的点） ============
{
  { // 士：斜一格且不出九宫
    const { gs, rv } = makeGame(); emptyBoard(gs);
    gs.board[1][8] = new ChessPiece('advisor', 0, 1, 8);
    t('士斜一格(九宫内)可走', rv.validateAdvisorMove(1, 8, 0, 7, 0) === true);
    t('士不能直走', rv.validateAdvisorMove(1, 8, 2, 8, 0) === false);
    t('士不能出九宫', rv.validateAdvisorMove(2, 7, 3, 8, 0) === false);
  }
  { // 将：直一格且不出九宫
    const { gs, rv } = makeGame(); emptyBoard(gs);
    gs.board[1][8] = new ChessPiece('king', 0, 1, 8);
    t('将直走一格(九宫内)可走', rv.validateKingMove(1, 8, 1, 7, 0) === true);
    t('将不能走两格', rv.validateKingMove(1, 8, 1, 6, 0) === false);
    t('将不能斜走', rv.validateKingMove(1, 8, 0, 7, 0) === false);
  }
  { // 兵/卒：未过河只能沿朝向前进
    const { gs, rv } = makeGame(); emptyBoard(gs);
    const pw = new ChessPiece('pawn', 3, 2, 3, 'down');   // 黑方象限 x0-4,y0-4，(2,3) 未过河
    gs.board[2][3] = pw;
    t('兵未过河可前进', rv.validatePawnMove(pw, 2, 3, 2, 4) === true);
    t('兵未过河不能横走', rv.validatePawnMove(pw, 2, 3, 3, 3) === false);
    t('兵未过河不能后退', rv.validatePawnMove(pw, 2, 3, 2, 2) === false);
  }
  { // 兵/卒：过河后可前进 + 两侧横走，但永不后退
    const { gs, rv } = makeGame(); emptyBoard(gs);
    const pw = new ChessPiece('pawn', 3, 6, 6, 'down');   // (6,6) 已在黑方象限之外 = 过河
    gs.board[6][6] = pw;
    t('兵过河可前进', rv.validatePawnMove(pw, 6, 6, 6, 7) === true);
    t('兵过河可横走(右)', rv.validatePawnMove(pw, 6, 6, 7, 6) === true);
    t('兵过河可横走(左)', rv.validatePawnMove(pw, 6, 6, 5, 6) === true);
    t('兵过河也不能后退', rv.validatePawnMove(pw, 6, 6, 6, 5) === false);
  }
  { // 马：纵向走日也要判纵向马腿
    const { gs, rv } = makeGame(); emptyBoard(gs);
    gs.board[5][5] = new ChessPiece('horse', 0, 5, 5);
    t('马纵走日(腿空)可走', rv.validateHorseMove(5, 5, 4, 7) === true);
    gs.board[5][6] = new ChessPiece('rook', 0, 5, 6);
    t('马纵走日(腿被占)不可走', rv.validateHorseMove(5, 5, 4, 7) === false);
  }
}

// ============ 3. 象 / 马 阻挡规则（确定性） ============
{
  { // 象走田，象眼空
    const { gs, rv } = makeGame(); emptyBoard(gs);
    gs.board[2][7] = new ChessPiece('elephant', 0, 2, 7);
    t('象走田(眼空)可走', rv.validateElephantMove(2, 7, 4, 9, 0) === true);
  }
  { // 象眼被占
    const { gs, rv } = makeGame(); emptyBoard(gs);
    gs.board[2][7] = new ChessPiece('elephant', 0, 2, 7);
    gs.board[3][8] = new ChessPiece('rook', 0, 3, 8);
    t('象眼被占不可走', rv.validateElephantMove(2, 7, 4, 9, 0) === false);
  }
  { // 象不过河
    const { gs, rv } = makeGame(); emptyBoard(gs);
    gs.board[2][5] = new ChessPiece('elephant', 0, 2, 5);
    t('象不过河', rv.validateElephantMove(2, 5, 0, 3, 0) === false);
  }
  { // 马走日，蹩马腿
    const { gs, rv } = makeGame(); emptyBoard(gs);
    gs.board[2][7] = new ChessPiece('horse', 0, 2, 7);
    t('马走日(无蹩腿)可走', rv.validateHorseMove(2, 7, 4, 8) === true);
    gs.board[3][7] = new ChessPiece('rook', 0, 3, 7);
    t('马蹩腿不可走', rv.validateHorseMove(2, 7, 4, 8) === false);
  }
}

// ============ 4. 回放导出/导入往返一致 ============
const Replay = require(path.join(ROOT, 'js/game/Replay.js'));
let replayChecks = 0;
for (let g = 0; g < 10; g++) {
  const { gs, pm, rv } = makeGame(MODES[g % 4]); gs.gamePhase = 'playing';
  for (let ply = 0; ply < 60; ply++) {
    const p = gs.currentPlayer; const all = [];
    for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) { const pc = gs.board[x][y]; if (pc && pc.player === p) for (const mv of rv.getValidMoves(x, y)) all.push({ x, y, mv }); }
    if (!all.length) break;
    const c = all[Math.floor(Math.random() * all.length)];
    gs.movePiece(c.x, c.y, c.mv.x, c.mv.y);
    if (gs.checkGameEnd()) break;
  }
  // 构造纯文本（与导出同样格式的核心：模式 + 走子 + 淘汰）
  const st = gs.rules;
  const modeTxt = st.mode === 'ffa' ? '四人混战' : '两两组队';
  const vicTxt = st.victory === 'last_team' ? '仅剩一队' : '吃将任意一方';
  const lines = ['四人象棋对局记录', '版本: 1', '模式: ' + modeTxt, '胜利条件: ' + vicTxt, '友伤: ' + (st.friendlyFire ? '开' : '关'), '走子:'];
  gs.moveHistory.forEach((mv, i) => lines.push(`${i + 1}. ${Config.PLAYER_COLORS[mv.player].name} ${Config.PIECE_NAMES[mv.player][mv.piece]} (${mv.from.x},${mv.from.y})->(${mv.to.x},${mv.to.y})`));
  (gs.eliminationLog || []).forEach(e => lines.push(`淘汰 ${Config.PLAYER_COLORS[e.player].name} ${e.atMove}`));
  const text = lines.join('\n');
  const live = new GameState();
  const br = { gameState: live, boardElement: { style: {} }, clearSelection() {}, renderPieces() {} };
  const rp = new Replay({ gameState: live, boardRenderer: br });
  const data = rp.parse(text);
  rp.enter(data); rp.goto(rp.moves.length);
  // 比对最终棋盘
  let same = true;
  for (let x = 0; x < 10 && same; x++) for (let y = 0; y < 10 && same; y++) {
    const a = gs.board[x][y], b = rp.replayState.board[x][y];
    const ka = a ? `${a.type}${a.player}` : '.';
    const kb = b ? `${b.type}${b.player}` : '.';
    if (ka !== kb) same = false;
  }
  replayChecks++;
  t('回放往返：最终棋盘一致', same);
  rp.exit();
}

// ============ 5. 结算不卡死（将被吃 / 困毙 一律淘汰，可连锁） ============
{
  let games2 = 0, plies2 = 0, stalls = 0;
  for (let g = 0; g < 40; g++) {
    const { gs, pm, rv } = makeGame(MODES[g % MODES.length]); gs.gamePhase = 'playing'; games2++;
    for (let ply = 0; ply < 400 && gs.gamePhase === 'playing'; ply++) {
      const p = gs.currentPlayer; const all = [];
      for (let x = 0; x < Config.BOARD_SIZE; x++) for (let y = 0; y < Config.BOARD_SIZE; y++) {
        const pc = gs.board[x][y];
        if (pc && pc.player === p) for (const mv of rv.getValidMoves(x, y)) all.push({ x, y, mv });
      }
      if (!all.length) { stalls++; break; }   // 结算后不该出现“当前方无棋可走”
      const c = all[Math.floor(Math.random() * all.length)];
      gs.movePiece(c.x, c.y, c.mv.x, c.mv.y); plies2++;
      // 复刻引擎的结算：先清“无将残子”，再 computeKnockouts(困毙) -> eliminate -> checkGameEnd -> nextPlayer
      let guard = 0;
      while (gs.gamePhase === 'playing' && guard++ < 8) {
        for (let q = 0; q < 4; q++) if (!gs.hasKing(q) && !gs.eliminationOrder.includes(q)) gs.eliminatePlayer(q);
        if (gs.checkGameEnd()) break;
        const kn = gs.computeKnockouts(rv);
        if (!kn.length) break;
        kn.forEach(k => gs.eliminatePlayer(k.player));
        if (gs.checkGameEnd()) break;
        if (!gs.hasKing(gs.currentPlayer)) gs.nextPlayer();
      }
    }
  }
  t('结算后不再出现“当前方无棋可走但未结束”', stalls === 0, 'stalls=' + stalls);
  console.log(`结算测试：${games2} 局 / ${plies2} 手，卡死 ${stalls}`);
}

// ============ 汇总 ============
console.log(`\n深度测试: ${pass} 通过, ${fail} 失败`);
console.log(`覆盖：${games} 局 / ${totalPlies} 手；走完的对局 ${finishedGames}；兵卒校验 ${pawnChecks}；被将军次数 ${mateChecks}；车/炮路径 ${pathChecks}；马/象/士/将/兵 差分 ${diffChecks}；回放往返 ${replayChecks}`);
if (fail) { console.log('\n失败样例:'); failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('✅ 全部通过');
