// 棋子管理器
class PieceManager {
    constructor(gameState) {
        this.gameState = gameState;
    }
    
    /**
     * 获取所有存活的棋子
     */
    getAllPieces() {
        const pieces = [];
        for (let x = 0; x < Config.BOARD_SIZE; x++) {
            for (let y = 0; y < Config.BOARD_SIZE; y++) {
                const piece = this.gameState.getPiece(x, y);
                if (piece) {
                    pieces.push(piece);
                }
            }
        }
        return pieces;
    }
    
    /**
     * 获取指定玩家的所有棋子
     */
    getPlayerPieces(player) {
        return this.getAllPieces().filter(piece => piece.player === player);
    }
    
    /**
     * 获取指定类型的棋子
     */
    getPiecesByType(type, player = null) {
        const pieces = this.getAllPieces().filter(piece => piece.type === type);
        return player !== null ? pieces.filter(piece => piece.player === player) : pieces;
    }
    
    /**
     * 查找将/帅的位置
     */
    findKing(player) {
        const kings = this.getPiecesByType(Config.PIECE_TYPES.KING, player);
        return kings.length > 0 ? kings[0] : null;
    }
    
    /**
     * 检查指定位置是否被敌方棋子攻击
     */
    isPositionUnderAttack(x, y, player) {
        // 检查所有敌方棋子是否能攻击该位置
        for (let px = 0; px < Config.BOARD_SIZE; px++) {
            for (let py = 0; py < Config.BOARD_SIZE; py++) {
                const piece = this.gameState.getPiece(px, py);
                if (piece && Utils.isEnemy(piece.player, player)) {
                    if (this.canPieceAttackPosition(piece, px, py, x, y)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
    
    /**
     * 检查棋子是否能攻击指定位置
     */
    canPieceAttackPosition(piece, fromX, fromY, toX, toY) {
        // 根据棋子类型检查攻击范围
        switch (piece.type) {
            case Config.PIECE_TYPES.KING:
                return this.canKingAttack(fromX, fromY, toX, toY, piece.player);
            case Config.PIECE_TYPES.ADVISOR:
                return this.canAdvisorAttack(fromX, fromY, toX, toY, piece.player);
            case Config.PIECE_TYPES.ELEPHANT:
                return this.canElephantAttack(fromX, fromY, toX, toY, piece.player);
            case Config.PIECE_TYPES.HORSE:
                return this.canHorseAttack(fromX, fromY, toX, toY);
            case Config.PIECE_TYPES.ROOK:
                return this.canRookAttack(fromX, fromY, toX, toY);
            case Config.PIECE_TYPES.CANNON:
                return this.canCannonAttack(fromX, fromY, toX, toY);
            case Config.PIECE_TYPES.PAWN:
                return this.canPawnAttack(fromX, fromY, toX, toY, piece.player);
            default:
                return false;
        }
    }
    
    /**
     * 将/帅攻击范围检查
     */
    canKingAttack(fromX, fromY, toX, toY, player) {
        // 将帅只能在九宫格内移动一格
        if (!Utils.isInPalace(toX, toY, player)) return false;
        
        const distance = Utils.getManhattanDistance(fromX, fromY, toX, toY);
        return distance === 1 && Utils.isInLine(fromX, fromY, toX, toY);
    }
    
    /**
     * 士/仕攻击范围检查
     */
    canAdvisorAttack(fromX, fromY, toX, toY, player) {
        // 士仕只能在九宫格内斜向移动一格
        if (!Utils.isInPalace(toX, toY, player)) return false;
        
        const dx = Math.abs(toX - fromX);
        const dy = Math.abs(toY - fromY);
        return dx === 1 && dy === 1;
    }
    
    /**
     * 相/象攻击范围检查
     */
    canElephantAttack(fromX, fromY, toX, toY, player) {
        // 象不能过河
        if (!Utils.isInPlayerArea(toX, toY, player)) return false;
        
        const dx = Math.abs(toX - fromX);
        const dy = Math.abs(toY - fromY);
        
        // 象走田字，检查象眼是否被阻挡
        if (dx === 2 && dy === 2) {
            return !CoordinateMapper.isElephantBlocked(fromX, fromY, toX, toY, this.gameState.board);
        }
        
        return false;
    }
    
    /**
     * 马攻击范围检查
     */
    canHorseAttack(fromX, fromY, toX, toY) {
        const dx = Math.abs(toX - fromX);
        const dy = Math.abs(toY - fromY);
        
        // 马走日字
        if ((dx === 2 && dy === 1) || (dx === 1 && dy === 2)) {
            return !CoordinateMapper.isHorseBlocked(fromX, fromY, toX, toY, this.gameState.board);
        }
        
        return false;
    }
    
    /**
     * 车攻击范围检查
     */
    canRookAttack(fromX, fromY, toX, toY) {
        // 车走直线
        if (!Utils.isInLine(fromX, fromY, toX, toY)) return false;
        
        // 检查路径是否被阻挡
        const path = Utils.getPathBetween(fromX, fromY, toX, toY);
        return path.every(pos => {
            if (Utils.isRiverPosition(pos.x, pos.y)) return true; // 可以跨越河界
            return this.gameState.getPiece(pos.x, pos.y) === null;
        });
    }
    
    /**
     * 炮攻击范围检查
     */
    canCannonAttack(fromX, fromY, toX, toY) {
        // 炮走直线
        if (!Utils.isInLine(fromX, fromY, toX, toY)) return false;
        
        // 炮需要隔一个子攻击
        const path = Utils.getPathBetween(fromX, fromY, toX, toY);
        const obstacles = path.filter(pos => {
            if (Utils.isRiverPosition(pos.x, pos.y)) return false; // 河界不算障碍
            return this.gameState.getPiece(pos.x, pos.y) !== null;
        });
        
        return obstacles.length === 1;
    }
    
    /**
     * 兵/卒攻击范围检查
     */
    canPawnAttack(fromX, fromY, toX, toY, player) {
        const directions = CoordinateMapper.getPawnMoveDirections(fromX, fromY, player);
        
        for (const direction of directions) {
            const nextPos = CoordinateMapper.getNextPosition(fromX, fromY, direction, 1);
            if (nextPos.x === toX && nextPos.y === toY) {
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * 检查将军状态
     */
    isInCheck(player) {
        const king = this.findKing(player);
        if (!king) return false;
        
        return this.isPositionUnderAttack(king.x, king.y, player);
    }
    
    /**
     * 检查将死状态
     */
    isCheckmate(player) {
        if (!this.isInCheck(player)) return false;
        
        // 尝试所有可能的移动，看是否能解除将军
        const playerPieces = this.getPlayerPieces(player);
        
        for (const piece of playerPieces) {
            const possibleMoves = this.getValidMoves(piece.x, piece.y);
            
            for (const move of possibleMoves) {
                // 模拟移动
                const originalPiece = this.gameState.getPiece(move.x, move.y);
                this.gameState.setPiece(move.x, move.y, piece);
                this.gameState.removePiece(piece.x, piece.y);
                
                // 检查是否还在将军状态
                const stillInCheck = this.isInCheck(player);
                
                // 恢复棋盘状态
                this.gameState.setPiece(piece.x, piece.y, piece);
                this.gameState.setPiece(move.x, move.y, originalPiece);
                
                if (!stillInCheck) {
                    return false; // 找到了解救方法，不是将死
                }
            }
        }
        
        return true; // 无法解救，将死
    }
    
    /**
     * 获取指定位置棋子的有效移动
     */
    getValidMoves(x, y) {
        const piece = this.gameState.getPiece(x, y);
        if (!piece) return [];
        
        // 这里会调用规则验证器来获取有效移动
        // 暂时返回空数组，在RuleValidator中实现具体逻辑
        return [];
    }
    
    /**
     * 统计玩家棋子
     */
    countPlayerPieces(player) {
        return this.getPlayerPieces(player).length;
    }
    
    /**
     * 获取棋盘的文本表示（用于调试）
     */
    getBoardText() {
        let text = '';
        for (let y = 0; y < Config.BOARD_SIZE; y++) {
            for (let x = 0; x < Config.BOARD_SIZE; x++) {
                const piece = this.gameState.getPiece(x, y);
                if (Utils.isRiverPosition(x, y)) {
                    text += '河';
                } else if (piece) {
                    text += piece.getName();
                } else {
                    text += '空';
                }
                text += ' ';
            }
            text += '\n';
        }
        return text;
    }
}

// 导出类（如果在模块环境中）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PieceManager;
}
