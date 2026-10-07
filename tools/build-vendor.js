/**
 * 重建 vendor/trystero.nostr.iife.js —— 联机信令库，打进仓库以便免 CDN、可离线。
 * 运行: TRYSTERO_VERSION=x.y.z ESBUILD_VERSION=x.y.z npm run vendor:trystero
 *
 * 为什么必须显式给版本：这个文件是**锁定快照**，它决定了联机协议可用的 API
 * （joinRoom 的第 3 个 callbacks 参数 / turnConfig / onJoinError 等）。随便换个版本
 * 可能静默改掉行为，所以这里不设默认值，并且重建后会校验这几个 API 仍在产物里。
 *
 * 注意：升级后必须重新跑一遍 `npm test` + `npm run e2e` 再提交（真浏览器 E2E 用的
 * 是 test/e2e/transport.js 桩，覆盖不到本文件，但联机行为要靠上面的单测兜）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'vendor/trystero.nostr.iife.js');
const TRYSTERO = process.env.TRYSTERO_VERSION;
const ESBUILD = process.env.ESBUILD_VERSION;

if (!TRYSTERO || !ESBUILD) {
  console.error('[build-vendor] 必须显式指定版本：\n'
    + '  TRYSTERO_VERSION=x.y.z ESBUILD_VERSION=x.y.z npm run vendor:trystero');
  process.exit(1);
}

const run = cmd => execSync(cmd, { cwd: ROOT, stdio: 'inherit' });

run(`npm i -D --no-save esbuild@${ESBUILD} trystero@${TRYSTERO}`);
run('npx esbuild node_modules/trystero/dist/index.mjs --bundle --format=iife '
  + '--global-name=Trystero --outfile=vendor/trystero.nostr.iife.js');

const out = fs.readFileSync(OUT, 'utf8');
const missing = ['joinRoom', 'turnConfig', 'onJoinError'].filter(api => !out.includes(api));
if (missing.length) {
  console.error(`[build-vendor] ✗ 产物里没找到：${missing.join(', ')}`
    + '\n该版本的 API 可能已变（或已压缩）——请检查 OnlineSession 后再提交。');
  process.exit(1);
}
const sha = crypto.createHash('sha256').update(out).digest('hex').slice(0, 12);
console.log(`[build-vendor] 已重建 vendor/trystero.nostr.iife.js（${(out.length / 1024).toFixed(0)} KB, sha256:${sha}）`);
