/**
 * 四人象棋 - APK 静态资源暂存
 * 运行: npm run build:web    （npx cap sync 前必须执行）
 *
 * 把 Web 端运行时真正需要的文件拷进 www/，供 Capacitor 打进 APK。
 * 用白名单而非整仓库拷贝——否则 test/、.git/、node_modules/、android/ 都会进安装包。
 * 同时注入原生标记：APK 内页面 origin 是 https://localhost，Service Worker
 * 既无意义又可能把旧代码缓存住，标记后 index.html 会跳过注册。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'www');

// 运行时真正会加载的文件，与 service-worker.js 的 PRECACHE 清单保持一致
const FILES = ['index.html', 'manifest.json', 'package.json'];
const DIRS = ['js', 'styles', 'vendor', 'assets/icons'];

// assets/images 是 README 截图，assets/*.jpg 约 1.2MB，不进包
const MARKER =
  '<script>window.__CHESS4P_NATIVE__=true;document.documentElement.classList.add("native-app");</script>';

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(full) : fs.statSync(full).size;
  }
  return total;
}

function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  for (const file of FILES) {
    fs.cpSync(path.join(ROOT, file), path.join(OUT, file));
  }
  for (const dir of DIRS) {
    fs.cpSync(path.join(ROOT, dir), path.join(OUT, dir), { recursive: true });
  }

  // 注入点选在 charset 之后：脚本不该排在建 charset 的 meta 前面，否则中文可能被判错编码
  const ANCHOR = '<meta charset="UTF-8">';
  const indexPath = path.join(OUT, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  if (!html.includes(ANCHOR)) {
    throw new Error(`index.html 里找不到注入锚点 ${ANCHOR}，原生标记未能写入`);
  }
  if (!html.includes('__CHESS4P_NATIVE__=true')) {
    fs.writeFileSync(indexPath, html.replace(ANCHOR, `${ANCHOR}\n    ${MARKER}`));
  }

  const kb = n => (n / 1024).toFixed(0) + ' KB';
  console.log(`已暂存到 www/（共 ${kb(dirSize(OUT))}）:`);
  for (const name of [...FILES, ...DIRS]) {
    const full = path.join(OUT, name);
    const size = fs.statSync(full).isDirectory() ? dirSize(full) : fs.statSync(full).size;
    console.log(`  ${name.padEnd(16)} ${kb(size)}`);
  }
}

main();
