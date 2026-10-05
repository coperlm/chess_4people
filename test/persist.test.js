/**
 * 存档（localStorage）保存/恢复 测试
 * 运行: node test/persist.test.js
 */
global.document = {
  getElementById: () => null,
  createElement: () => ({ classList: { add() {}, remove() {}, contains() {} }, style: {}, appendChild() {} }),
  addEventListener() {}
};
global.window = {};
// 真实可用的内存版 localStorage
const _store = {};
global.localStorage = {
  getItem: k => (k in _store ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: k => { delete _store[k]; }
};

const path = require('path');
const ROOT = path.join(__dirname, '..');
global.Config = require(path.join(ROOT, 'js/utils/Config.js'));
global.Utils = require(path.join(ROOT, 'js/utils/Utils.js'));
global.CoordinateMapper = require(path.join(ROOT, 'js/board/CoordinateMapper.js'));
const { GameState, ChessPiece } = require(path.join(ROOT, 'js/game/GameState.js'));
global.ChessPiece = ChessPiece;
global.GameState = GameState;
const GameStatePersistence = require(path.join(ROOT, 'js/utils/GameStatePersistence.js'));

let pass = 0, fail = 0; const failures = [];
function t(name, cond, extra) { if (cond) pass++; else { fail++; failures.push(name + (extra ? '  -> ' + extra : '')); } }

function engineStub(gs) {
  return { gameState: gs, boardRenderer: { reset() {} }, updateUI() {}, updateMoveHistory() {} };
}

{
  const p = new GameStatePersistence();
  const gs = new GameState();
  gs.setRules({ mode: 'team', victory: 'last_team', friendlyFire: false });
  gs.startGame();

  // 走两手 + 一次吃子 + 一次悔棋（覆盖 moves / captured / undoLog）
  gs.movePiece(0, 6, 0, 5);                 // 红兵
  gs.currentPlayer = 2;
  gs.movePiece(9, 6, 9, 5);                 // 绿卒
  gs.undoMove();                            // 悔棋 -> undoLog

  // 记一个淘汰（模拟有人被吃将）
  gs.eliminatePlayer(3);

  const ok = p.saveGameState(gs);
  t('保存成功', ok === true);

  const raw = localStorage.getItem('chess_game_state');
  const saved = JSON.parse(raw);
  t('存档为 v3 且用紧凑 pieces（无嵌套 board）', saved.v === 3 && Array.isArray(saved.pieces) && saved.board === undefined, 'v=' + saved.v);
  t('存档不再冗余保存 pieceCounts', saved.pieceCounts === undefined);
  t('存档保存了 winner/isDraw/eliminationOrder', ('winner' in saved) && ('isDraw' in saved) && Array.isArray(saved.eliminationOrder));

  // 恢复
  const gs2 = new GameState();
  const eng = engineStub(gs2);
  const restored = p.restoreGameState(eng, p.loadGameState());
  t('恢复成功', restored === true);
  t('棋盘棋子数一致', (() => { let a = 0, b = 0; for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) { if (gs.board[x][y]) a++; if (gs2.board[x][y]) b++; } return a === b; })());
  t('兵/卒 facing 保留', gs2.getPiece(0, 5) && gs2.getPiece(0, 5).facing === 'up');
  t('棋子计数重算正确', JSON.stringify(gs2.pieceCounts) === JSON.stringify(gs.pieceCounts), JSON.stringify(gs2.pieceCounts));
  t('currentPlayer/turn 一致', gs2.currentPlayer === gs.currentPlayer && gs2.turn === gs.turn);
  t('rules 一致', gs2.rules.mode === 'team' && gs2.rules.victory === 'last_team');
  t('eliminationOrder 保留（不再丢失）', gs2.eliminationOrder.includes(3));
  t('moveHistory 还原为富对象（from.x 存在）', gs2.moveHistory.length === 1 && gs2.moveHistory[0].from && gs2.moveHistory[0].from.x === 0, JSON.stringify(gs2.moveHistory[0]));
  t('undoLog 保留', gs2.undoLog.length === 1 && gs2.undoLog[0].player === 2, JSON.stringify(gs2.undoLog));

  // v2 兼容：旧版嵌套 board + moveHistory 对象
  const v2 = {
    v: 2, timestamp: Date.now(), rules: { mode: 'ffa', victory: 'last_team', friendlyFire: false },
    gamePhase: 'playing', currentPlayer: 0, turn: 5,
    board: (() => { const b = []; for (let x = 0; x < 10; x++) { b[x] = []; for (let y = 0; y < 10; y++) b[x][y] = null; } b[0][9] = { type: 'king', player: 0, facing: null }; b[9][0] = { type: 'king', player: 1, facing: null }; return b; })(),
    moveHistory: [{ player: 0, piece: 'pawn', from: { x: 0, y: 6 }, to: { x: 0, y: 5 }, captured: null }]
  };
  const gs3 = new GameState();
  const ok3 = p.restoreGameState(engineStub(gs3), v2);
  t('v2 旧存档仍可恢复', ok3 === true && gs3.getPiece(0, 9) && gs3.moveHistory.length === 1);
  t('v2 恢复后计数重算', gs3.pieceCounts[0] === 1 && gs3.pieceCounts[1] === 1);
}

console.log(`\n存档测试: ${pass} 通过, ${fail} 失败`);
if (fail) { console.log('\n失败项:'); failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('✅ 全部通过');
