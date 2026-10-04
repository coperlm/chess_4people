/**
 * 回放导出/导入 + 签名 测试
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
const { webcrypto } = require('crypto');
global.crypto = global.crypto || webcrypto;

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

(async () => {
  const rp = new Replay({});
  const data = rp.parse(SAMPLE);
  t('解析出 2 步走子', data.moves.length === 2, JSON.stringify(data.moves));
  t('解析出时间头', data.meta['时间'] === '2026-10-05 14:30:00', data.meta['时间']);
  t('解析模式=组队', data.rules.mode === 'team');
  t('无签名文件 signature=null', data.signature === null);
  t('首步坐标正确', JSON.stringify(data.moves[0]) === JSON.stringify({ from: [0, 6], to: [0, 5] }), JSON.stringify(data.moves[0]));

  // 签名：正文 -> 哈希 -> 前置签名行 -> 解析 -> 验签
  const sig = await rp._sign(SAMPLE);
  t('签名是 64 位十六进制(SHA-256)', /^[0-9a-f]{64}$/.test(sig), sig);
  const signedText = '签名: ' + sig + '\n' + SAMPLE;
  const d2 = rp.parse(signedText);
  t('解析出签名', d2.signature === sig);
  t('正文还原一致', d2.body === SAMPLE);
  t('验签通过', (await rp.verify(d2)) === true);
  t('篡改后验签失败', (await rp.verify(rp.parse(signedText.replace('(0,5)', '(0,4)')))) === false);

  // 用假引擎做回放
  const live = new GameState();
  const br = { gameState: live, boardElement: { style: {} }, clearSelection() {}, renderPieces() {} };
  const ge = { gameState: live, boardRenderer: br };
  const player = new Replay(ge);
  player.enter(d2);
  t('回放进入后可控制到 2 步', player.moves.length === 2 && player.active === true);
  player.goto(1);
  t('第 1 步：红兵到 (0,5)', !!player.replayState.getPiece(0, 5) && player.replayState.getPiece(0, 6) === null);
  player.goto(2);
  t('第 2 步：绿卒到 (9,5)', !!player.replayState.getPiece(9, 5) && player.replayState.getPiece(9, 6) === null);
  player.exit();
  t('退出回放后恢复实时棋盘', br.gameState === live && player.active === false);

  // 淘汰事件回放
  const d3 = rp.parse(SAMPLE + '\n淘汰 绿方 2');
  t('解析出淘汰事件', d3.eliminations.length === 1 && d3.eliminations[0].player === 2 && d3.eliminations[0].atMove === 2, JSON.stringify(d3.eliminations));
  const player2 = new Replay(ge);
  player2.enter(d3);
  player2.goto(1);
  t('淘汰前：绿将仍在', !!player2.replayState.getPiece(9, 9));
  player2.goto(2);
  t('淘汰后：绿方棋子被移除', player2.replayState.getPiece(9, 9) === null && player2.replayState.getPiece(7, 6) === null);
  player2.exit();

  let threw = false;
  try { rp.parse('这不是回放文件'); } catch (e) { threw = true; }
  t('非法文件会抛错', threw);

  console.log(`\n回放测试: ${pass} 通过, ${fail} 失败`);
  if (fail) { console.log('\n失败项:'); failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
  console.log('✅ 全部通过');
})();
