// 工具函数库
class Utils {
    /**
     * 检查坐标是否在棋盘范围内
     */
    static isValidPosition(x, y) {
        return x >= 0 && x < Config.BOARD_SIZE && y >= 0 && y < Config.BOARD_SIZE;
    }
    
    /**
     * 检查坐标是否在可落子区域内
     */
    static isPlayablePosition(x, y) {
        // 检查是否在任一玩家的可落子区域内
        for (let player = 0; player < 4; player++) {
            const area = Config.PLAYABLE_AREAS[player];
            if (x >= area.x[0] && x <= area.x[1] && y >= area.y[0] && y <= area.y[1]) {
                return true;
            }
        }
        return false;
    }
    
    /**
     * 检查坐标是否在指定玩家的区域内
     */
    static isInPlayerArea(x, y, player) {
        const area = Config.PLAYABLE_AREAS[player];
        return x >= area.x[0] && x <= area.x[1] && y >= area.y[0] && y <= area.y[1];
    }
    
    /**
     * 检查坐标是否在指定玩家的九宫格内
     */
    static isInPalace(x, y, player) {
        const palace = Config.PALACE_AREAS[player];
        return x >= palace.x[0] && x <= palace.x[1] && y >= palace.y[0] && y <= palace.y[1];
    }
    
    /**
     * 获取两个坐标之间的曼哈顿距离
     */
    static getManhattanDistance(x1, y1, x2, y2) {
        return Math.abs(x1 - x2) + Math.abs(y1 - y2);
    }
    
    /**
     * 检查两个坐标是否在同一直线上
     */
    static isInLine(x1, y1, x2, y2) {
        return x1 === x2 || y1 === y2;
    }
    
    /**
     * 获取两个坐标之间的所有中间坐标
     */
    static getPathBetween(fromX, fromY, toX, toY) {
        const path = [];
        const dx = Math.sign(toX - fromX);
        const dy = Math.sign(toY - fromY);
        
        let x = fromX + dx;
        let y = fromY + dy;
        
        while (x !== toX || y !== toY) {
            path.push({ x, y });
            x += dx;
            y += dy;
        }
        
        return path;
    }
    
    /**
     * 深拷贝对象
     */
    static deepCopy(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj.getTime());
        if (obj instanceof Array) return obj.map(item => this.deepCopy(item));
        
        const copy = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                copy[key] = this.deepCopy(obj[key]);
            }
        }
        return copy;
    }
    
    /**
     * 生成唯一ID
     */
    static generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }
    
    /**
     * 显示消息提示
     */
    static showMessage(message, type = 'info', duration = 3000) {
        const toast = document.getElementById('messageToast');
        const text = document.getElementById('messageText');
        
        if (toast && text) {
            // 处理多行消息
            if (message.includes('\n')) {
                text.innerHTML = message.split('\n').map(line => 
                    line.trim() ? `<div>${Utils.escapeHtml(line)}</div>` : '<div>&nbsp;</div>'
                ).join('');
            } else {
                text.textContent = message;
            }
            
            // 设置颜色
            toast.className = toast.className.replace(/bg-\w+-\d+/, '');
            switch (type) {
                case 'success':
                    toast.classList.add('bg-green-500');
                    break;
                case 'error':
                    toast.classList.add('bg-red-500');
                    // 错误消息显示更长时间
                    duration = Math.max(duration, 6000);
                    break;
                case 'warning':
                    toast.classList.add('bg-yellow-500');
                    duration = Math.max(duration, 4000);
                    break;
                default:
                    toast.classList.add('bg-blue-500');
            }
            
            // 调整toast大小以适应内容
            if (message.length > 50 || message.includes('\n')) {
                toast.classList.add('max-w-md', 'text-sm');
            } else {
                toast.classList.remove('max-w-md', 'text-sm');
            }
            
            // 显示消息
            toast.style.transform = 'translateY(0)';
            
            // 自动隐藏（移出屏幕足够远，避免底部露出绿条）
            setTimeout(() => {
                toast.style.transform = 'translateY(200%)';
            }, duration);
        }
        
        // 同时在控制台输出
        const prefix = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : type === 'success' ? '✅' : 'ℹ️';
    }

    /**
     * 棋盘中央的醒目事件横幅（圆环 + 文字）：将军 / 困毙 / 将死 / 将帅被吃。
     * @param {string} headline 圆环内的大字（如「困毙」「将军」）
     * @param {string} type 'check' | 'danger' | 'info'
     * @param {string} sub 圆环下方的小字（如「黑方 无子可动」）
     */
    static showBanner(headline, type = 'check', sub = '') {
        if (typeof document === 'undefined') return;
        const el = document.getElementById('eventBanner');
        if (!el) return;
        const txt = document.getElementById('eventBannerText');
        const subEl = document.getElementById('eventBannerSub');
        if (txt) txt.textContent = headline || '';
        if (subEl) subEl.textContent = sub || '';
        el.dataset.type = type;
        // 先移除再强制重排，保证每次都能重播入场动画
        el.classList.remove('event-banner--show', 'event-banner--out');
        void el.offsetWidth;
        el.classList.add('event-banner--show');
        if (Utils._bannerTimer) clearTimeout(Utils._bannerTimer);
        Utils._bannerTimer = setTimeout(() => {
            el.classList.add('event-banner--out');
            Utils._bannerTimer = setTimeout(() => {
                el.classList.remove('event-banner--show', 'event-banner--out');
                Utils._bannerTimer = null;
            }, 360);
        }, 1500);
    }
    
    /**
     * 页内二次确认（替代原生 confirm）。原生 confirm 在微信/部分 WebView 里会出现“关闭网页”按钮，
     * 误触会直接退出对局，故统一改用页面内弹窗。
     * @returns {Promise<boolean>} 点“确定”为 true，点“取消”/关闭为 false；DOM 不可用时退回原生 confirm。
     */
    static confirmModal(message, okText = '确定', cancelText = '取消') {
        return new Promise(resolve => {
            const el = (typeof document !== 'undefined') ? document.getElementById('confirmModal') : null;
            if (!el) { resolve(typeof confirm === 'function' ? !!confirm(message) : true); return; }
            // 若上一个确认还没答复（如快速连点两次），先按“取消”了结上一个，避免两个 Promise 同时 resolve 而双发
            if (Utils._confirmFinish) { try { Utils._confirmFinish(false); } catch (e) { /* ignore */ } }
            const txt = document.getElementById('confirmModalText');
            const ok = document.getElementById('confirmModalOk');
            const no = document.getElementById('confirmModalCancel');
            if (txt) txt.textContent = message;
            if (ok) ok.textContent = okText;
            if (no) no.textContent = cancelText;
            let done = false;
            const finish = val => {
                if (done) return;
                done = true;
                if (Utils._confirmFinish === finish) Utils._confirmFinish = null;
                if (ok) ok.removeEventListener('click', onOk);
                if (no) no.removeEventListener('click', onNo);
                el.removeEventListener('click', onOverlay);
                el.classList.add('hidden');
                resolve(val);
            };
            const onOk = () => finish(true);
            const onNo = () => finish(false);
            const onOverlay = e => { if (e.target === el) finish(false); };
            if (ok) ok.addEventListener('click', onOk);
            if (no) no.addEventListener('click', onNo);
            el.addEventListener('click', onOverlay);
            Utils._confirmFinish = finish;
            el.classList.remove('hidden');
        });
    }

    /**
     * HTML转义工具
     */
    static escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    /**
     * 防抖函数
     */
    static debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
}

// 导出工具类（如果在模块环境中）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Utils;
}
