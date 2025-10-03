// 规则验证器
class RuleValidator {
    constructor(gameState, pieceManager) {
        this.gameState = gameState;
        this.pieceManager = pieceManager;
    }
    
    /**
     * 验证移动是否合法
     */
    isValidMove(fromX, fromY, toX, toY) {
        // 基础验证
        if (!this.isBasicMoveValid(fromX, fromY, toX, toY)) {
            return false;
        }
        
        const piece = this.gameState.getPiece(fromX, fromY);
        if (!piece) return false;
        
        // 根据棋子类型验证移动
        if (!this.isPieceMovementValid(piece, fromX, fromY, toX, toY)) {
            return false;
        }
        
        // 检查移动后是否会导致自己被将军
        if (this.wouldBeInCheckAfterMove(fromX, fromY, toX, toY, piece.player)) {
            return false;
        }
        
        return true;
    }
    
    /**
     * 基础移动验证
     */
    isBasicMoveValid(fromX, fromY, toX, toY) {
        // 坐标范围检查
        if (!Utils.isValidPosition(fromX, fromY) || !Utils.isValidPosition(toX, toY)) {
            return false;
        }
        
        // 不能移动到河界位置
        if (Utils.isRiverPosition(toX, toY)) {
            return false;
        }
        
        // 起点和终点不能相同
        if (fromX === toX && fromY === toY) {
            return false;
        }
        
        // 起点必须有棋子
        const piece = this.gameState.getPiece(fromX, fromY);
        if (!piece) {
            return false;
        }
        
        // 只能移动当前玩家的棋子
        if (piece.player !== this.gameState.currentPlayer) {
            return false;
        }
        
        // 不能吃自己的棋子
        const targetPiece = this.gameState.getPiece(toX, toY);
        if (targetPiece && piece.player === targetPiece.player) {
            return false;
        }
        
        // 不能吃队友的棋子
        if (targetPiece && Utils.isTeammate(piece.player, targetPiece.player)) {
            return false;
        }
        
        return true;
    }
    
    /**
     * 验证特定棋子的移动规则
     */
    isPieceMovementValid(piece, fromX, fromY, toX, toY) {
        switch (piece.type) {
            case Config.PIECE_TYPES.KING:
                return this.validateKingMove(fromX, fromY, toX, toY, piece.player);
            case Config.PIECE_TYPES.ADVISOR:
                return this.validateAdvisorMove(fromX, fromY, toX, toY, piece.player);
            case Config.PIECE_TYPES.ELEPHANT:
                return this.validateElephantMove(fromX, fromY, toX, toY, piece.player);
            case Config.PIECE_TYPES.HORSE:
                return this.validateHorseMove(fromX, fromY, toX, toY);
            case Config.PIECE_TYPES.ROOK:
                return this.validateRookMove(fromX, fromY, toX, toY);
            case Config.PIECE_TYPES.CANNON:
                return this.validateCannonMove(fromX, fromY, toX, toY);
            case Config.PIECE_TYPES.PAWN:
                return this.validatePawnMove(fromX, fromY, toX, toY, piece.player);
            default:
                return false;
        }
    }
    
    /**
     * 验证将/帅移动
     */
    validateKingMove(fromX, fromY, toX, toY, player) {
        // 将帅只能在九宫格内移动
        if (!Utils.isInPalace(toX, toY, player)) {
            return false;
        }
        
        // 只能移动一格
        const distance = Utils.getManhattanDistance(fromX, fromY, toX, toY);
        if (distance !== 1) {
            return false;
        }
        
        // 只能走直线
        if (!Utils.isInLine(fromX, fromY, toX, toY)) {
            return false;
        }
        
        return true;
    }
    
    /**
     * 验证士/仕移动
     */
    validateAdvisorMove(fromX, fromY, toX, toY, player) {
        // 士仕只能在九宫格内移动
        if (!Utils.isInPalace(toX, toY, player)) {
            return false;
        }
        
        // 只能斜向移动一格
        const dx = Math.abs(toX - fromX);
        const dy = Math.abs(toY - fromY);
        
        return dx === 1 && dy === 1;
    }
    
    /**
     * 验证相/象移动
     */
    validateElephantMove(fromX, fromY, toX, toY, player) {
        // 象不能过河
        if (!Utils.isInPlayerArea(toX, toY, player)) {
            return false;
        }
        
        // 象走田字
        const dx = Math.abs(toX - fromX);
        const dy = Math.abs(toY - fromY);
        
        if (dx !== 2 || dy !== 2) {
            return false;
        }
        
        // 检查象眼是否被阻挡
        return !CoordinateMapper.isElephantBlocked(fromX, fromY, toX, toY, this.gameState.board);
    }
    
    /**
     * 验证马移动
     */
    validateHorseMove(fromX, fromY, toX, toY) {
        const dx = Math.abs(toX - fromX);
        const dy = Math.abs(toY - fromY);
        
        // 马走日字
        if (!((dx === 2 && dy === 1) || (dx === 1 && dy === 2))) {
            return false;
        }
        
        // 检查马腿是否被阻挡
        return !CoordinateMapper.isHorseBlocked(fromX, fromY, toX, toY, this.gameState.board);
    }
    
    /**
     * 验证车移动
     */
    validateRookMove(fromX, fromY, toX, toY) {
        // 车走直线
        if (!Utils.isInLine(fromX, fromY, toX, toY)) {
            return false;
        }
        
        // 检查路径是否被阻挡
        const path = Utils.getPathBetween(fromX, fromY, toX, toY);
        return path.every(pos => {
            return this.gameState.getPiece(pos.x, pos.y) === null;
        });
    }
    
    /**
     * 验证炮移动
     */
    validateCannonMove(fromX, fromY, toX, toY) {
        // 炮走直线
        if (!Utils.isInLine(fromX, fromY, toX, toY)) {
            return false;
        }
        
        const targetPiece = this.gameState.getPiece(toX, toY);
        const path = Utils.getPathBetween(fromX, fromY, toX, toY);
        
        // 计算路径上的障碍物
        const obstacles = path.filter(pos => {
            return this.gameState.getPiece(pos.x, pos.y) !== null;
        });
        
        if (targetPiece) {
            // 攻击时需要隔一个子
            return obstacles.length === 1;
        } else {
            // 移动时路径必须为空
            return obstacles.length === 0;
        }
    }
    
    /**
     * 验证兵/卒移动
     */
    validatePawnMove(fromX, fromY, toX, toY, player) {
        const directions = CoordinateMapper.getPawnMoveDirections(fromX, fromY, player);
        
        // 检查是否在允许的方向上移动一格或跨河移动
        for (const direction of directions) {
            // 正常移动一格
            const nextPos = CoordinateMapper.getNextPosition(fromX, fromY, direction, 1);
            if (nextPos.x === toX && nextPos.y === toY) {
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * 检查移动后是否会导致自己被将军
     */
    wouldBeInCheckAfterMove(fromX, fromY, toX, toY, player) {
        // 模拟移动
        const piece = this.gameState.getPiece(fromX, fromY);
        const targetPiece = this.gameState.getPiece(toX, toY);
        
        // 执行临时移动
        this.gameState.removePiece(fromX, fromY);
        this.gameState.setPiece(toX, toY, piece);
        
        // 检查是否被将军
        const inCheck = this.pieceManager.isInCheck(player);
        
        // 恢复棋盘状态
        this.gameState.setPiece(fromX, fromY, piece);
        this.gameState.setPiece(toX, toY, targetPiece);
        
        return inCheck;
    }
    
    /**
     * 获取指定位置棋子的所有合法移动
     */
    getValidMoves(x, y) {
        const piece = this.gameState.getPiece(x, y);
        if (!piece) return [];
        
        const moves = [];
        
        // 根据棋子类型生成可能的移动
        const possibleMoves = this.generatePossibleMoves(piece, x, y);
        
        // 验证每个移动是否合法
        for (const move of possibleMoves) {
            if (this.isValidMove(x, y, move.x, move.y)) {
                moves.push(move);
            }
        }
        
        return moves;
    }
    
    /**
     * 根据棋子类型生成可能的移动
     */
    generatePossibleMoves(piece, x, y) {
        switch (piece.type) {
            case Config.PIECE_TYPES.KING:
                return this.generateKingMoves(x, y, piece.player);
            case Config.PIECE_TYPES.ADVISOR:
                return this.generateAdvisorMoves(x, y, piece.player);
            case Config.PIECE_TYPES.ELEPHANT:
                return this.generateElephantMoves(x, y, piece.player);
            case Config.PIECE_TYPES.HORSE:
                return this.generateHorseMoves(x, y);
            case Config.PIECE_TYPES.ROOK:
                return this.generateRookMoves(x, y);
            case Config.PIECE_TYPES.CANNON:
                return this.generateCannonMoves(x, y);
            case Config.PIECE_TYPES.PAWN:
                return this.generatePawnMoves(x, y, piece.player);
            default:
                return [];
        }
    }
    
    /**
     * 生成将/帅的可能移动
     */
    generateKingMoves(x, y, player) {
        const moves = [];
        const directions = ['up', 'down', 'left', 'right'];
        
        for (const direction of directions) {
            const pos = CoordinateMapper.getNextPosition(x, y, direction, 1);
            if (Utils.isValidPosition(pos.x, pos.y) && Utils.isInPalace(pos.x, pos.y, player)) {
                moves.push(pos);
            }
        }
        
        return moves;
    }
    
    /**
     * 生成士/仕的可能移动
     */
    generateAdvisorMoves(x, y, player) {
        const moves = [];
        const diagonalDirections = ['up-left', 'up-right', 'down-left', 'down-right'];
        
        for (const direction of diagonalDirections) {
            const pos = CoordinateMapper.getNextPosition(x, y, direction, 1);
            if (Utils.isValidPosition(pos.x, pos.y) && Utils.isInPalace(pos.x, pos.y, player)) {
                moves.push(pos);
            }
        }
        
        return moves;
    }
    
    /**
     * 生成相/象的可能移动
     */
    generateElephantMoves(x, y, player) {
        return CoordinateMapper.getElephantMoves(x, y, player);
    }
    
    /**
     * 生成马的可能移动
     */
    generateHorseMoves(x, y) {
        return CoordinateMapper.getHorseMoves(x, y);
    }
    
    /**
     * 生成车的可能移动
     */
    generateRookMoves(x, y) {
        return CoordinateMapper.getLineMoves(x, y);
    }
    
    /**
     * 生成炮的可能移动
     */
    generateCannonMoves(x, y) {
        return CoordinateMapper.getLineMoves(x, y);
    }
    
    /**
     * 生成兵/卒的可能移动
     */
    generatePawnMoves(x, y, player) {
        const moves = [];
        const directions = CoordinateMapper.getPawnMoveDirections(x, y, player);
        
        for (const direction of directions) {
            // 移动一格
            const pos = CoordinateMapper.getNextPosition(x, y, direction, 1);
            if (Utils.isValidPosition(pos.x, pos.y) && Utils.isPlayablePosition(pos.x, pos.y)) {
                moves.push(pos);
            }
        }
        
        return moves;
    }
}

// 导出类（如果在模块环境中）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RuleValidator;
}
