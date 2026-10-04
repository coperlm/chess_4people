/**
 * 回放导出/导入测试
 * 运行: node test/replay.test.js
 */
global.document = {
  getElementById: () => null,
  createElement: () => ({ classList: { add() {}, remove() {}, contains() {} }, style: {}, appendChild() {}, click() {}, remove() {} }),
  body: { appendChild() {} },
  addEventListener() {}
};
global.window = {};
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
global.Blob = function () {};

const path = require('path');
const ROOT = path.join(__dirname, '..');
global.Config = require(path.join(ROOT, 'js/utils/Config.js'));
global.Utils = require(path.join(ROOT, 'js/utils/Utils.js'));
global.CoordinateMapper = require(path.join(ROOT, 'js/board/CoordinateMapper.js'));
const { GameState, ChessPiece } = require(path.join(ROOT, 'js/game/GameState.js'));
global.ChessPiece = ChessPiece;
global.GameState = GameState;
const Replay = require(path.join(ROOT, 'js/game/Replay.js'));

let pass = 0, fail = 0; const failures = [];
function t(name, cond, extra) { if (cond) pass++; else { fail++; failures.push(name + (extra ? '  -> ' + extra : '')); } }

const SAMPLE = [
  '四人象棋对局记录',
  '版本: 1',
  '时间: 2026-10-05 14:30:00',
  '模式: 两两组队',
  '胜利条件: 将死任意一方',
  '友伤: 关',
  '结果: 未结束',
  '走子数: 2',
  '走子:',
  '1. 红 兵 (0,6)->(0,5)',
  '2. 绿 卒 (9,6)->(9,5)'
].join('\n');

const rp = new Replay({});
const data = rp.parse(SAMPLE);
t('解析出 2 步走子', data.moves.length === 2, JSON.stringify(data.moves));
t('解析出时间头', data.meta['时间'] === '2026-10-05 14:30:00', data.meta['时间']);
t('解析模式=组队', data.rules.mode === 'team');
t('首步坐标正确', JSON.stringify(data.moves[0]) === JSON.stringify({ from: [0, 6], to: [0, 5] }), JSON.stringify(data.moves[0]));

// 用假引擎做回放
const live = new GameState();
const br = { gameState: live, boardElement: { style: {} }, clearSelection() {}, renderPieces() {} };
const ge = { gameState: live, boardRenderer: br };
const player = new Replay(ge);
player.enter(data);
t('回放进入后可控制到 2 步', player.moves.length === 2 && player.active === true);

player.goto(1);
t('第 1 步：红兵到 (0,5)', !!player.replayState.getPiece(0, 5) && player.replayState.getPiece(0, 6) === null);
player.goto(2);
t('第 2 步：绿卒到 (9,5)', !!player.replayState.getPiece(9, 5) && player.replayState.getPiece(9, 6) === null);
t('回放期间棋盘渲染指向回放状态', br.gameState === player.replayState);

player.exit();
t('退出回放后恢复实时棋盘', br.gameState === live && player.active === false);

// 非法文件
let threw = false;
try { rp.parse('这不是回放文件'); } catch (e) { threw = true; }
t('非法文件会抛错', threw);

console.log(`\n回放测试: ${pass} 通过, ${fail} 失败`);
if (fail) { console.log('\n失败项:'); failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('✅ 全部通过');
