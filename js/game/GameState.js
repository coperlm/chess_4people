// 游戏状态管理类
class GameState {
    constructor() {
        this.board = this.initializeBoard();
        this.currentPlayer = 0; // 从红方开始
        this.gamePhase = 'ready'; // ready, playing, finished
        this.moveHistory = [];
        this.selectedPiece = null;
        this.possibleMoves = [];
        this.winner = null;
        this.turn = 1;
        
        // 玩家棋子计数
        this.pieceCounts = {
            0: 10, // 红方
            1: 10, // 蓝方
            2: 10, // 绿方
            3: 10  // 黑方
        };
        
        // 初始化棋子
        this.initializePieces();
    }
    
    /**
     * 初始化棋盘
     */
    initializeBoard() {
        const board = [];
        for (let x = 0; x < Config.BOARD_SIZE; x++) {
            board[x] = [];
            for (let y = 0; y < Config.BOARD_SIZE; y++) {
                board[x][y] = null;
            }
        }
        return board;
    }
    
    /**
     * 初始化棋子
     */
    initializePieces() {
        // 为每个玩家放置初始棋子
        for (let player = 0; player < 4; player++) {
            const positions = Config.INITIAL_POSITIONS[player];
            positions.forEach(pos => {
                const piece = new ChessPiece(pos.type, player, pos.x, pos.y);
                this.setPiece(pos.x, pos.y, piece);
            });
        }
    }
    
    /**
     * 在指定位置设置棋子
     */
    setPiece(x, y, piece) {
        if (Utils.isValidPosition(x, y)) {
            this.board[x][y] = piece;
            if (piece) {
                piece.x = x;
                piece.y = y;
            }
        }
    }
    
    /**
     * 获取指定位置的棋子
     */
    getPiece(x, y) {
        if (Utils.isValidPosition(x, y)) {
            return this.board[x][y];
        }
        return null;
    }
    
    /**
     * 移除指定位置的棋子
     */
    removePiece(x, y) {
        if (Utils.isValidPosition(x, y)) {
            const piece = this.board[x][y];
            this.board[x][y] = null;
            return piece;
        }
        return null;
    }
    
    /**
     * 移动棋子
     */
    movePiece(fromX, fromY, toX, toY) {
        const piece = this.getPiece(fromX, fromY);
        const capturedPiece = this.getPiece(toX, toY);
        
        if (!piece) return false;
        
        // 移除原位置的棋子
        this.removePiece(fromX, fromY);
        
        // 如果目标位置有敌方棋子，移除它
        if (capturedPiece) {
            this.pieceCounts[capturedPiece.player]--;
        }
        
        // 放置棋子到新位置
        this.setPiece(toX, toY, piece);
        
        // 记录移动
        const move = {
            id: Utils.generateId(),
            player: piece.player,
            piece: piece.type,
            from: { x: fromX, y: fromY },
            to: { x: toX, y: toY },
            captured: capturedPiece,
            turn: this.turn,
            timestamp: Date.now()
        };
        
        this.moveHistory.push(move);
        
        // 切换到下一个玩家
        this.nextPlayer();
        
        return true;
    }
    
    /**
     * 切换到下一个玩家（顺时针轮转）
     */
    nextPlayer() {
        // 顺时针轮转顺序：红(0) → 绿(2) → 蓝(1) → 黑(3)
        const clockwiseOrder = [0, 2, 1, 3];
        const currentIndex = clockwiseOrder.indexOf(this.currentPlayer);
        const nextIndex = (currentIndex + 1) % 4;
        this.currentPlayer = clockwiseOrder[nextIndex];
        
        this.selectedPiece = null;
        this.possibleMoves = [];
        this.turn++;
    }
    
    /**
     * 选择棋子
     */
    selectPiece(x, y) {
        const piece = this.getPiece(x, y);
        
        // 如果点击的不是当前玩家的棋子，取消选择
        if (!piece || piece.player !== this.currentPlayer) {
            this.selectedPiece = null;
            this.possibleMoves = [];
            return false;
        }
        
        this.selectedPiece = { x, y, piece };
        this.possibleMoves = this.calculatePossibleMoves(x, y);
        return true;
    }
    
    /**
     * 计算指定位置棋子的可能移动
     */
    calculatePossibleMoves(x, y) {
        const piece = this.getPiece(x, y);
        if (!piece) return [];
        
        // 这里会调用规则验证器来计算具体的移动
        // 暂时返回空数组，后续会在RuleValidator中实现
        return [];
    }
    
    /**
     * 检查是否可以移动到指定位置
     */
    canMoveTo(x, y) {
        return this.possibleMoves.some(move => move.x === x && move.y === y);
    }
    
    /**
     * 检查游戏是否结束
     */
    checkGameEnd() {
        // 检查是否有玩家的将/帅被吃掉
        const kings = [];
        for (let x = 0; x < Config.BOARD_SIZE; x++) {
            for (let y = 0; y < Config.BOARD_SIZE; y++) {
                const piece = this.getPiece(x, y);
                if (piece && piece.type === Config.PIECE_TYPES.KING) {
                    kings.push(piece.player);
                }
            }
        }
        
        // 找出被消灭的玩家
        const eliminatedPlayers = [];
        for (let player = 0; player < 4; player++) {
            if (!kings.includes(player)) {
                eliminatedPlayers.push(player);
            }
        }
        
        // 如果有玩家被消灭，检查获胜条件
        if (eliminatedPlayers.length > 0) {
            this.gamePhase = 'finished';
            this.determineWinner(eliminatedPlayers);
            return true;
        }
        
        return false;
    }
    
    /**
     * 确定获胜者
     */
    determineWinner(eliminatedPlayers) {
        // 如果队伍1的任一成员被消灭，队伍2获胜
        if (eliminatedPlayers.some(p => Config.TEAMS.TEAM1.includes(p))) {
            this.winner = 'TEAM2';
        }
        // 如果队伍2的任一成员被消灭，队伍1获胜
        else if (eliminatedPlayers.some(p => Config.TEAMS.TEAM2.includes(p))) {
            this.winner = 'TEAM1';
        }
    }
    
    /**
     * 重置游戏
     */
    reset() {
        this.board = this.initializeBoard();
        this.currentPlayer = 0;
        this.gamePhase = 'ready';
        this.moveHistory = [];
        this.selectedPiece = null;
        this.possibleMoves = [];
        this.winner = null;
        this.turn = 1;
        this.pieceCounts = { 0: 10, 1: 10, 2: 10, 3: 10 };
        this.initializePieces();
    }
    
    /**
     * 开始游戏
     */
    startGame() {
        this.gamePhase = 'playing';
    }
    
    /**
     * 获取游戏状态信息
     */
    getGameInfo() {
        return {
            currentPlayer: this.currentPlayer,
            gamePhase: this.gamePhase,
            turn: this.turn,
            pieceCounts: Utils.deepCopy(this.pieceCounts),
            winner: this.winner,
            moveCount: this.moveHistory.length
        };
    }
    
    /**
     * 获取最后一步移动
     */
    getLastMove() {
        return this.moveHistory.length > 0 ? this.moveHistory[this.moveHistory.length - 1] : null;
    }
    
    /**
     * 悔棋
     */
    undoMove() {
        if (this.moveHistory.length === 0) return false;
        
        const lastMove = this.moveHistory.pop();
        
        // 恢复棋子位置
        const piece = this.getPiece(lastMove.to.x, lastMove.to.y);
        this.removePiece(lastMove.to.x, lastMove.to.y);
        this.setPiece(lastMove.from.x, lastMove.from.y, piece);
        
        // 如果有被吃掉的棋子，恢复它
        if (lastMove.captured) {
            this.setPiece(lastMove.to.x, lastMove.to.y, lastMove.captured);
            this.pieceCounts[lastMove.captured.player]++;
        }
        
        // 恢复玩家轮次
        this.currentPlayer = lastMove.player;
        this.turn = lastMove.turn;
        this.selectedPiece = null;
        this.possibleMoves = [];
        
        return true;
    }
}

// 棋子类
class ChessPiece {
    constructor(type, player, x, y) {
        this.type = type;
        this.player = player;
        this.x = x;
        this.y = y;
        this.id = Utils.generateId();
    }
    
    /**
     * 获取棋子的显示名称
     */
    getName() {
        return Config.PIECE_NAMES[this.player][this.type];
    }
    
    /**
     * 获取棋子的颜色信息
     */
    getColorInfo() {
        return Config.PLAYER_COLORS[this.player];
    }
}

// 导出类（如果在模块环境中）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GameState, ChessPiece };
}
