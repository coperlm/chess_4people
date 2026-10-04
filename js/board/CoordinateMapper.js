// 坐标映射工具类
class CoordinateMapper {
    /**
     * 将棋盘坐标转换为DOM元素ID
     */
    static positionToId(x, y) {
        return `cell-${x}-${y}`;
    }
    
    /**
     * 将DOM元素ID转换为棋盘坐标
     */
    static idToPosition(id) {
        const parts = id.split('-');
        if (parts.length === 3 && parts[0] === 'cell') {
            return {
                x: parseInt(parts[1]),
                y: parseInt(parts[2])
            };
        }
        return null;
    }
    
    /**
     * 兵/卒固定朝向的兜底值（仅用于老存档缺少 facing 时）
     */
    static getDefaultPawnFacing(player) {
        switch (player) {
            case 0: return 'up';    // 红方
            case 1: return 'left';  // 蓝方
            case 2: return 'down';  // 绿方
            case 3: return 'right'; // 黑方
            default: return 'up';
        }
    }
    
    /**
     * 检查兵/卒是否已过河（离开本方象限即视为过河）
     */
    static isPawnCrossedRiver(x, y, player) {
        return !Utils.isInPlayerArea(x, y, player);
    }
    
    /**
     * 根据固定朝向与是否过河，得到可移动方向
     * - 未过河：只能沿 facing 前进一格
     * - 过河后：可前进 + 两侧垂直方向（永不后退，绝不含 facing 的反向）
     */
    static getPawnMoveDirections(facing, crossed) {
        if (!facing) return [];
        if (!crossed) return [facing];
        if (facing === 'left' || facing === 'right') {
            return [facing, 'up', 'down'];
        }
        return [facing, 'left', 'right'];
    }
    
    /**
     * 根据方向获取下一个坐标
     */
    static getNextPosition(x, y, direction, steps = 1) {
        switch (direction) {
            case 'up':
                return { x, y: y - steps };
            case 'down':
                return { x, y: y + steps };
            case 'left':
                return { x: x - steps, y };
            case 'right':
                return { x: x + steps, y };
            case 'up-left':
                return { x: x - steps, y: y - steps };
            case 'up-right':
                return { x: x + steps, y: y - steps };
            case 'down-left':
                return { x: x - steps, y: y + steps };
            case 'down-right':
                return { x: x + steps, y: y + steps };
            default:
                return { x, y };
        }
    }
    
    /**
     * 获取马的所有可能移动位置
     */
    static getHorseMoves(x, y) {
        const moves = [];
        const horsePattern = [
            { dx: -2, dy: -1 }, { dx: -2, dy: 1 },
            { dx: -1, dy: -2 }, { dx: -1, dy: 2 },
            { dx: 1, dy: -2 },  { dx: 1, dy: 2 },
            { dx: 2, dy: -1 },  { dx: 2, dy: 1 }
        ];
        
        horsePattern.forEach(pattern => {
            const newX = x + pattern.dx;
            const newY = y + pattern.dy;
            
            if (Utils.isValidPosition(newX, newY)) {
                moves.push({ x: newX, y: newY });
            }
        });
        
        return moves;
    }
    
    /**
     * 获取象的所有可能移动位置
     */
    static getElephantMoves(x, y, player) {
        const moves = [];
        const elephantPattern = [
            { dx: -2, dy: -2 }, { dx: -2, dy: 2 },
            { dx: 2, dy: -2 },  { dx: 2, dy: 2 }
        ];
        
        elephantPattern.forEach(pattern => {
            const newX = x + pattern.dx;
            const newY = y + pattern.dy;
            
            // 象不能过河，只能在本方区域移动
            if (Utils.isValidPosition(newX, newY) && Utils.isInPlayerArea(newX, newY, player)) {
                moves.push({ x: newX, y: newY });
            }
        });
        
        return moves;
    }
    
    /**
     * 获取直线移动的所有位置（车、炮使用）
     */
    static getLineMoves(x, y) {
        const moves = [];
        const directions = ['up', 'down', 'left', 'right'];
        
        directions.forEach(direction => {
            for (let step = 1; step < Config.BOARD_SIZE; step++) {
                const pos = this.getNextPosition(x, y, direction, step);
                
                if (!Utils.isValidPosition(pos.x, pos.y)) break;
                moves.push({ x: pos.x, y: pos.y });
            }
        });
        
        return moves;
    }
    
    /**
     * 检查马腿是否被阻挡
     */
    static isHorseBlocked(fromX, fromY, toX, toY, board) {
        const dx = toX - fromX;
        const dy = toY - fromY;
        
        // 确定马腿位置
        let blockX, blockY;
        
        if (Math.abs(dx) === 2) {
            // 横向移动2格
            blockX = fromX + Math.sign(dx);
            blockY = fromY;
        } else {
            // 纵向移动2格
            blockX = fromX;
            blockY = fromY + Math.sign(dy);
        }
        
        // 检查马腿位置是否有棋子
        return board[blockX] && board[blockX][blockY] !== null;
    }
    
    /**
     * 检查象眼是否被阻挡
     */
    static isElephantBlocked(fromX, fromY, toX, toY, board) {
        const blockX = fromX + Math.sign(toX - fromX);
        const blockY = fromY + Math.sign(toY - fromY);
        
        // 检查象眼位置是否有棋子
        return board[blockX] && board[blockX][blockY] !== null;
    }
}

// 导出坐标映射类（如果在模块环境中）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CoordinateMapper;
}
