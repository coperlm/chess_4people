const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');

const PORT = 8080;
const HOST = '0.0.0.0'; // 监听所有网络接口，允许局域网访问

// 获取本机IP地址
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // 跳过内部和非IPv4地址
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

// MIME类型映射
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.md': 'text/markdown'
};

const server = http.createServer((req, res) => {
    // 只取路径部分：以前把 req.url（含 ?query）直接拼进路径，导致
    // /index.html?room=xxxx（本地测邀请链接）一律 404。
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch (e) {
        pathname = '/';
    }
    if (pathname === '/' || pathname === '') pathname = '/index.html';

    const filePath = path.join(__dirname, pathname);

    // 目录穿越防护：解析后必须仍在仓库目录内（path.join 会把 .. 归一化）
    if (filePath !== __dirname && !filePath.startsWith(__dirname + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>403 - 禁止访问</h1>', 'utf-8');
        return;
    }

    // 获取文件扩展名
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    // 读取并返回文件
    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT' || err.code === 'EISDIR') {
                res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end('<h1>404 - 文件未找到</h1>', 'utf-8');
            } else {
                res.writeHead(500);
                res.end('服务器错误: ' + err.code, 'utf-8');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, HOST, () => {
    const localIP = getLocalIP();
    
    console.log('========================================');
    console.log('   🎮 四人象棋游戏服务器已启动！');
    console.log('========================================');
    console.log('💻 本机访问:');
    console.log(`   http://localhost:${PORT}`);
    console.log(`   http://127.0.0.1:${PORT}`);
    console.log('');
    console.log('📱 手机访问 (确保手机和电脑在同一WiFi):');
    console.log(`   http://${localIP}:${PORT}`);
    console.log('');
    console.log('📝 提示:');
    console.log('   1. 手机浏览器输入上面的地址');
    console.log('   2. 可以将地址添加到手机主屏幕');
    console.log('   3. 支持触摸操作');
    console.log('');
    console.log('⚠️  防火墙提示: 如果手机无法访问，请允许防火墙放行');
    console.log('');
    console.log('按 Ctrl+C 停止服务器');
    console.log('========================================\n');

    // 自动打开浏览器（CI/无头环境跳过）
    if (!process.env.CI) {
        const url = `http://localhost:${PORT}`;
        const start = process.platform === 'win32' ? 'start' :
                      process.platform === 'darwin' ? 'open' : 'xdg-open';
        exec(`${start} ${url}`);
    }
});

// 优雅关闭
process.on('SIGTERM', () => {
    console.log('\n正在关闭服务器...');
    server.close(() => {
        console.log('服务器已关闭');
        process.exit(0);
    });
});
