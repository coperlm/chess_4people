/**
 * 引擎结算回归测试：GameEngine.resolveAfterMove / endGame
 * 运行: node test/engine.test.js
 *
 * 背景（回归 bug）：本地落子走的是 BoardRenderer.executeMove —— 它先调用
 * gameState.checkGameEnd()（该调用会把 phase 直接置为 'finished' 并淘汰被吃将的一方），
 * 之后才调用 gameEngine.onMoveCompleted() → resolveAfterMove()。
 * 因为 resolveAfterMove 的 while 条件要求 phase === 'playing'，循环整段被跳过，
 * 其内部的 if(finished) endGame() 永远不会执行 → 吃将即胜后不弹结算面板。
 *
 * 本测试直接驱动真实的 resolveAfterMove / endGame（仅桩掉 DOM 相关的 updateUI / 棋盘 / 通报），
 * 覆盖：吃将即胜、循环内困毙结算、以及“未结束的对局绝不能误结算”。
 */

global.document = {
  getElementById: () => null,
  createElement: () => ({ classList: { add() {}, remove() {}, contains() {} }, style: {}, appendChild() {} }),
  querySelectorAll: () => [],
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
const GameEngine = require(path.join(ROOT, 'js/game/GameEngine.js'));

let pass = 0, fail = 0; const failures = [];
function t(name, cond, extra) { if (cond) pass++; else { fail++; if (failures.length < 25) failures.push(name + (extra ? '  -> ' + extra : '')); } }

const ANY_KING = { mode: 'team', victory: 'any_king', friendlyFire: false };

function clearBoard(gs) {
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) gs.board[x][y] = null;
}

/** 用真实的 GameEngine 原型方法搭一个“只桩掉 DOM 副作用”的引擎 */
function makeEngine(rules) {
  const gs = new GameState();
  gs.setRules(rules || ANY_KING);
  const pm = new PieceManager(gs);
  const rv = new RuleValidator(gs, pm);
  gs.ruleValidator = rv;
  pm.ruleValidator = rv;

  const ge = Object.create(GameEngine.prototype);
  ge.gameState = gs;
  ge.pieceManager = pm;
  ge.ruleValidator = rv;
  ge.boardRenderer = { fadeOutPieces() {}, renderPieces() {}, clearSelection() {} };
  ge.notifyKnockout = () => {};       // 通报只是 UI 提示，非本测试关注点
  ge.updateUI = () => {};
  ge.showGameResult = () => { ge._shown = (ge._shown || 0) + 1; };
  ge.recordGameStats = () => {};
  ge.isGameActive = true;
  ge.gameStartTime = Date.now();
  ge._endHandled = false;
  ge._resultTimer = null;

  let endCalls = 0;
  const protoEnd = ge.endGame;        // 真实 endGame（含幂等守卫）
  ge.endGame = function () { endCalls++; return protoEnd.apply(this, arguments); };
  ge._endCalls = () => endCalls;
  return ge;
}

function cleanup(ge) { if (ge._resultTimer) { clearTimeout(ge._resultTimer); ge._resultTimer = null; } }

// ------------------------------------------------------------------
// A) 吃将即胜（回归主用例）：phase 已被 executeMove 的 checkGameEnd 置为 finished
//    此时 resolveAfterMove 必须照常收尾（endGame），否则本地不弹结算面板。
// ------------------------------------------------------------------
(function testCaptureEnds() {
  const ge = makeEngine();
  const gs = ge.gameState;
  clearBoard(gs);
  gs.board[9][9] = new ChessPiece('king', 0, 9, 9);
  gs.board[0][5] = new ChessPiece('rook', 0, 0, 5);
  // 黑方(3)的将已被吃：直接不放
  gs.currentPlayer = 0;
  gs.eliminationOrder = [];
  gs.outOfPlay = [1, 2];
  gs.gamePhase = 'playing';

  const ended = gs.checkGameEnd();    // ← executeMove 在 onMoveCompleted() 之前就是这么调的
  t('[吃将] checkGameEnd 直接结束对局', ended === true && gs.gamePhase === 'finished', `phase=${gs.gamePhase}`);
  t('[吃将] 被吃将的一方进入出局名单', gs.eliminationOrder.includes(3), JSON.stringify(gs.eliminationOrder));
  t('[吃将] 收尾前尚未结算', ge._endHandled === false);

  ge.resolveAfterMove();
  t('[吃将] resolveAfterMove 必须触发结算', ge._endHandled === true, `endHandled=${ge._endHandled}`);
  t('[吃将] 已排定结算面板定时器', !!ge._resultTimer);
  t('[吃将] isGameActive 置为 false', ge.isGameActive === false);
  t('[吃将] endGame 恰好调用一次', ge._endCalls() === 1, `calls=${ge._endCalls()}`);

  // 幂等：重复结算不得重复排定时器（否则会重复弹面板/重复记统计）
  const timer1 = ge._resultTimer;
  ge.resolveAfterMove();
  t('[吃将] 重复结算不会重排定时器（幂等）', ge._resultTimer === timer1);
  cleanup(ge);
})();

// ------------------------------------------------------------------
// B) 循环内结算（困毙/缺将）路径仍正常结束 —— 防止修复把原本可用的路径改坏
// ------------------------------------------------------------------
(function testLoopEnds() {
  const ge = makeEngine();
  const gs = ge.gameState;
  clearBoard(gs);
  gs.board[9][9] = new ChessPiece('king', 0, 9, 9);
  gs.board[5][5] = new ChessPiece('king', 1, 5, 5);
  // 黑方(3)无将、尚未出局：交给循环内的 ① 步结算
  gs.currentPlayer = 0;
  gs.eliminationOrder = [];
  gs.outOfPlay = [2];
  gs.gamePhase = 'playing';

  ge.resolveAfterMove();
  t('[循环] 缺失将的一方被结算出局', gs.eliminationOrder.includes(3), JSON.stringify(gs.eliminationOrder));
  t('[循环] 对局被判定结束', gs.gamePhase === 'finished', `phase=${gs.gamePhase}`);
  t('[循环] 同样触发了一次结算', ge._endCalls() === 1 && ge._endHandled === true, `calls=${ge._endCalls()}`);
  cleanup(ge);
})();

// ------------------------------------------------------------------
// C) 未结束的对局绝不能误结算（防止“按最终 phase 收尾”改得过火）
// ------------------------------------------------------------------
(function testNoFalseEnd() {
  const ge = makeEngine();
  const gs = ge.gameState;
  gs.startGame();                     // 正常开局（初始布局）
  t('[未结束] 开局后为 playing', gs.gamePhase === 'playing');

  ge.resolveAfterMove();
  t('[未结束] 不得触发结算', ge._endCalls() === 0 && ge._endHandled === false, `calls=${ge._endCalls()}`);
  t('[未结束] 对局仍在进行', gs.gamePhase === 'playing');
  cleanup(ge);
})();

// ------------------------------------------------------------------
// D) 求和必须先二次确认（与“认输/悔棋”一致）：拒绝不和棋，同意才和棋
// ------------------------------------------------------------------
async function testDrawConfirm() {
  const ge = makeEngine();
  const gs = ge.gameState;
  gs.startGame(); ge.isGameActive = true;

  const origConfirm = Utils.confirmModal, origShow = Utils.showMessage;
  Utils.showMessage = () => {};
  let asked = null;
  Utils.confirmModal = (msg) => { asked = msg; return Promise.resolve(false); };

  ge.draw();
  await Promise.resolve(); await Promise.resolve();
  t('[求和] 会先弹确认', typeof asked === 'string' && asked.length > 0, 'asked=' + asked);
  t('[求和] 拒绝确认则不结束对局', gs.gamePhase === 'playing' && !gs.isDraw, 'phase=' + gs.gamePhase);

  Utils.confirmModal = (msg) => { asked = msg; return Promise.resolve(true); };
  ge.draw();
  await Promise.resolve(); await Promise.resolve();
  t('[求和] 同意确认才和棋', gs.gamePhase === 'finished' && gs.isDraw === true, 'phase=' + gs.gamePhase);

  Utils.confirmModal = origConfirm; Utils.showMessage = origShow;
  cleanup(ge);
}

(async () => {
  await testDrawConfirm();
  console.log(`\n引擎结算测试: ${pass} 通过, ${fail} 失败`);
  if (fail) { console.log('失败用例：\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('✅ 全部通过');
})();
