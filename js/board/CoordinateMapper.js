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
     * 根据玩家和兵的位置获取其前进方向
     * 每个玩家有两个相邻敌人，兵面向最近的那个
     */
    static getPlayerDirection(player) {
        // 这是一个简化版本，实际应该根据兵的具体位置确定
        // 这里返回主要方向，具体的兵移动方向在getPawnMoveDirections中处理
        switch (player) {
            case 0: return 'up';    // 红方主要向上
            case 1: return 'left';  // 蓝方主要向左  
            case 2: return 'down';  // 绿方主要向下
            case 3: return 'right'; // 黑方主要向右
            default: return 'up';
        }
    }
    
    /**
     * 根据兵的具体位置获取其移动方向
     * 每个玩家的兵分别面向两个相邻的敌人
     */
    static getPawnDirectionByPosition(x, y, player) {
        const area = Config.PLAYABLE_AREAS[player];
        const centerX = (area.x[0] + area.x[1]) / 2;
        const centerY = (area.y[0] + area.y[1]) / 2;
        
        switch (player) {
            case 0: // 红方在左下角 [0-4, 6-10]
                // 相邻敌人：蓝方(右上)，黑方(左上)
                if (y < centerY) {
                    return 'up';    // 上方的兵向上面向黑方
                } else {
                    return 'right'; // 下方的兵向右面向蓝方
                }
            case 1: // 蓝方在右上角 [6-10, 0-4]  
                // 相邻敌人：红方(左下)，绿方(右下)
                if (x < centerX) {
                    return 'left';  // 左侧的兵向左面向红方
                } else {
                    return 'down';  // 右侧的兵向下面向绿方
                }
            case 2: // 绿方在右下角 [6-10, 6-10]
                // 相邻敌人：蓝方(右上)，红方(左下)  
                if (y < centerY) {
                    return 'up';    // 上方的兵向上面向蓝方
                } else {
                    return 'left';  // 下方的兵向左面向红方
                }
            case 3: // 黑方在左上角 [0-4, 0-4]
                // 相邻敌人：红方(左下)，蓝方(右上)
                if (x < centerX) {
                    return 'down';  // 左侧的兵向下面向红方
                } else {
                    return 'right'; // 右侧的兵向右面向蓝方
                }
            default: 
                return 'up';
        }
    }
    
    /**
     * 检查兵/卒是否已过河
     */
    static isPawnCrossedRiver(x, y, player) {
        const area = Config.PLAYABLE_AREAS[player];
        
        // 如果不在本方区域，说明已过河
        return !Utils.isInPlayerArea(x, y, player);
    }
    
    /**
     * 获取兵/卒的可移动方向
     */
    static getPawnMoveDirections(x, y, player) {
        const directions = [];
        const isCrossed = this.isPawnCrossedRiver(x, y, player);
        
        if (!isCrossed) {
            // 未过河，只能朝向最近的相邻敌人方向移动
            const direction = this.getPawnDirectionByPosition(x, y, player);
            directions.push(direction);
        } else {
            // 过河后，可以左右移动和继续前进
            const mainDirection = this.getPawnDirectionByPosition(x, y, player);
            directions.push(mainDirection);
            
            // 根据主方向添加侧向移动
            if (mainDirection === 'right' || mainDirection === 'left') {
                // 横向移动的兵，过河后可以纵向移动
                directions.push('up', 'down');
            } else {
                // 纵向移动的卒，过河后可以横向移动
                directions.push('left', 'right');
            }
        }
        
        return directions;
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
                if (Utils.isRiverPosition(pos.x, pos.y)) continue;
                
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
