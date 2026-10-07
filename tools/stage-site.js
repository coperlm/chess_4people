/**
 * 四人象棋 - 站点产物暂存（只打包运行时需要的文件）
 * 运行: npm run stage:site   （deploy-pages.yml 在注入凭据之后调用）
 *
 * 为什么需要：Pages 部署默认上传整个仓库（只排除 .git/.github），会把 android/、test/、
 * tools/、assets/images、server.js 等一起发布——实测 4.6 MB vs 运行时真正需要的 0.9 MB。
 * 这里按白名单暂存到 .site/（不入库），并**校验** index.html / manifest.json /
 * service-worker.js 里引用的本地文件都已包含：漏一个就报错退出，避免上线才发现 404
 * （尤其是 SW 的 PRECACHE：addAll 有一个 404 整个安装都会失败）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.site');

// 运行时真正会加载的（与 service-worker.js 的 PRECACHE 清单保持一致）
const FILES = ['index.html', 'manifest.json', 'package.json', 'service-worker.js'];
const DIRS = ['js', 'styles', 'vendor', 'assets/icons'];

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const normalize = u => {
  const s = String(u).replace(/^\.\//, '').replace(/^\//, '');
  return (s === '' || s === '.') ? 'index.html' : s;
};
const exists = rel => { try { return fs.statSync(path.join(OUT, rel)).isFile(); } catch (e) { return false; } };

function htmlRefs(html) {
  const out = [];
  for (const m of html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)) {
    const u = m[1].trim();
    if (/^(https?:)?\/\//i.test(u) || u.startsWith('#') || u.startsWith('data:') || u.startsWith('mailto:')) continue;
    out.push(u);
  }
  return out;
}

function swRefs(sw) {
  const m = sw.match(/PRECACHE\s*=\s*\[([\s\S]*?)\]/);
  if (!m) throw new Error('service-worker.js 里找不到 PRECACHE 数组（结构变了？）');
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]);
}

function dirSize(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of FILES) fs.cpSync(path.join(ROOT, f), path.join(OUT, f));
  for (const d of DIRS) fs.cpSync(path.join(ROOT, d), path.join(OUT, d), { recursive: true });

  const refs = new Set([
    ...htmlRefs(read('index.html')),
    ...JSON.parse(read('manifest.json')).icons.map(i => i.src),
    ...swRefs(read('service-worker.js'))
  ]);
  const missing = [...refs].map(normalize).filter(r => !exists(r));
  if (missing.length) {
    console.error('[stage-site] ✗ 暂存产物缺少被引用的文件，已放弃：');
    missing.forEach(m => console.error('   - ' + m));
    if (missing.includes('js/utils/ice-secrets.js')) {
      console.error('   （TURN 凭据文件还没生成 → 先跑 `npm run inject:ice`；CI 里由 workflow 注入）');
    }
    fs.rmSync(OUT, { recursive: true, force: true });
    process.exit(1);
  }

  const mb = n => (n / 1048576).toFixed(2) + ' MB';
  console.log(`[stage-site] 已暂存到 .site/：${mb(dirSize(OUT))}（校验 ${refs.size} 个本地引用全部存在）`);
}

main();
