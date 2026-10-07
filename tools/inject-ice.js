/**
 * 生成 js/utils/ice-secrets.js —— 存放 TURN 凭据，**该文件不入库**（见 .gitignore）。
 * 运行: npm run inject:ice   （npm run serve / e2e / build:web 也会自动前置执行）
 *
 * 为什么要有这一步：GitHub Pages 是纯静态站，没有服务端，凭据必须在**构建/部署时**写进
 * 要发布的产物里；直接写进源码 = 提交到公开仓库。所以凭据放两处、源码只留空：
 *   1) CI：GitHub Secret `CHESS4P_TURN_JSON`（值是 Metered 给的数组字面量，从 '[' 到 ']'）
 *   2) 本地：仓库根的 `Metered.txt`（Metered 控制台的 RTCConfiguration snippet 原样保存）
 *
 * ⚠️ 产物里的凭据仍然是**公开可下载**的（任何人都能查看网页 JS）——本脚本只保证
 *    "不提交进 git"，不代表"别人拿不到"。要真正保密需改用临时凭据（见 README）。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'js/utils/ice-secrets.js');
const LOCAL_SRC = path.join(ROOT, 'Metered.txt');

const HEADER = `// 由 tools/inject-ice.js 生成 —— 请勿手改、请勿提交（已在 .gitignore）。
// 运行时读取 window.__CHESS4P_TURN__，为 TURN 中继的 ICE 服务器列表；空数组表示只用 STUN。
`;

/** 从 Metered 的 snippet / 数组字面量里取出 [ ... ] 部分（不做 eval） */
function extractArray(text) {
  if (!text) return null;
  const i = text.indexOf('[');
  const j = text.lastIndexOf(']');
  if (i < 0 || j <= i) return null;
  const arr = text.slice(i, j + 1).trim();
  if (!/urls/.test(arr)) return null;                          // 至少要有 urls 字段
  if (!/turns?:/i.test(arr)) return null;                      // 且要有 turn/turns 才算有效
  return arr;
}

function readSource() {
  const env = (process.env.CHESS4P_TURN_JSON || '').trim();
  if (env) return { text: env, from: 'CHESS4P_TURN_JSON' };
  try {
    const t = fs.readFileSync(LOCAL_SRC, 'utf8');
    if (t.trim()) return { text: t, from: 'Metered.txt' };
  } catch (e) { /* 本地没有该文件是正常的 */ }
  return { text: '', from: '' };
}

function countServers(arrLiteral) {
  // 粗略统计条目数（顶层对象数）——只用于日志，不打印任何凭据内容
  const m = arrLiteral.match(/\{/g);
  return m ? m.length : 0;
}

function main() {
  const { text, from } = readSource();
  const arr = extractArray(text);

  if (!arr) {
    if (fs.existsSync(OUT)) {
      console.log('[inject-ice] 未找到凭据来源，保留已生成的 js/utils/ice-secrets.js（不覆盖）。');
      return;
    }
    fs.writeFileSync(OUT, `${HEADER}window.__CHESS4P_TURN__ = [];\n`);
    console.log('[inject-ice] 未配置 TURN 凭据 → 生成空占位（仅用 STUN）。');
    return;
  }

  fs.writeFileSync(OUT, `${HEADER}window.__CHESS4P_TURN__ = ${arr};\n`);
  console.log(`[inject-ice] 已从 ${from} 注入 ${countServers(arr)} 条 ICE 服务器 → js/utils/ice-secrets.js（未打印凭据）`);
  console.log('[inject-ice] 注意：该文件会被发布到网页，凭据对访问者可见（仅"未入库"，非"保密"）。');
}

main();
