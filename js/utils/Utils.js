// 工具函数库
class Utils {
    /**
     * 检查坐标是否在棋盘范围内
     */
    static isValidPosition(x, y) {
        return x >= 0 && x < Config.BOARD_SIZE && y >= 0 && y < Config.BOARD_SIZE;
    }
    
    /**
     * 检查坐标是否是河界位置
     */
    static isRiverPosition(x, y) {
        return x === Config.RIVER_POSITION || y === Config.RIVER_POSITION;
    }
    
    /**
     * 检查坐标是否在可落子区域内
     */
    static isPlayablePosition(x, y) {
        // 河界位置也是可以落子的，兵/卒可以过河
        if (this.isRiverPosition(x, y)) return true;
        
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
     * 获取两个坐标之间的方向
     */
    static getDirection(fromX, fromY, toX, toY) {
        const dx = toX - fromX;
        const dy = toY - fromY;
        
        if (dx === 0 && dy > 0) return 'down';
        if (dx === 0 && dy < 0) return 'up';
        if (dx > 0 && dy === 0) return 'right';
        if (dx < 0 && dy === 0) return 'left';
        if (dx > 0 && dy > 0) return 'down-right';
        if (dx < 0 && dy > 0) return 'down-left';
        if (dx > 0 && dy < 0) return 'up-right';
        if (dx < 0 && dy < 0) return 'up-left';
        
        return 'none';
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
     * 格式化移动记录
     */
    static formatMove(piece, fromX, fromY, toX, toY, captured = null) {
        const pieceName = Config.PIECE_NAMES[piece.player][piece.type];
        const captureText = captured ? `吃${Config.PIECE_NAMES[captured.player][captured.type]}` : '';
        return `${pieceName}(${fromX},${fromY})→(${toX},${toY}) ${captureText}`.trim();
    }
    
    /**
     * 检查是否为队友
     */
    static isTeammate(player1, player2) {
        return (Config.TEAMS.TEAM1.includes(player1) && Config.TEAMS.TEAM1.includes(player2)) ||
               (Config.TEAMS.TEAM2.includes(player1) && Config.TEAMS.TEAM2.includes(player2));
    }
    
    /**
     * 检查是否为敌人
     */
    static isEnemy(player1, player2) {
        return !this.isTeammate(player1, player2) && player1 !== player2;
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
            
            // 自动隐藏
            setTimeout(() => {
                toast.style.transform = 'translateY(100%)';
            }, duration);
        }
        
        // 同时在控制台输出
        const prefix = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : type === 'success' ? '✅' : 'ℹ️';
        console.log(`${prefix} ${message}`);
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
