// 游戏状态管理类
class GameState {
    constructor() {
        this.board = this.initializeBoard();
        this.currentPlayer = 0; // 默认红方开始
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
     * 轮换到下一个玩家（支持跳过空位玩家）
     */
    nextPlayer() {
        // 顺时针轮转顺序：红(0) → 绿(2) → 蓝(1) → 黑(3)
        const clockwiseOrder = [0, 2, 1, 3];
        const currentIndex = clockwiseOrder.indexOf(this.currentPlayer);
        
        // 获取房间中的活跃玩家列表（网络模式）
        const activePlayers = this.getActivePlayers();
        
        if (activePlayers.length === 0) {
            // 单机模式或无房间信息，按原逻辑进行
            const nextIndex = (currentIndex + 1) % 4;
            this.currentPlayer = clockwiseOrder[nextIndex];
        } else {
            // 网络模式：跳过没有玩家的位置
            let attempts = 0;
            let nextIndex = currentIndex;
            do {
                nextIndex = (nextIndex + 1) % 4;
                attempts++;
            } while (!activePlayers.includes(clockwiseOrder[nextIndex]) && attempts < 4);
            
            this.currentPlayer = clockwiseOrder[nextIndex];
        }
        
        this.selectedPiece = null;
        this.possibleMoves = [];
        this.turn++;
    }
    
    /**
     * 获取活跃玩家列表（网络模式下从全局获取）
     */
    getActivePlayers() {
        // 尝试从全局的网络控制器获取活跃玩家
        if (typeof window !== 'undefined' && window.multiplayerInterface && 
            window.multiplayerInterface.networkController && 
            window.multiplayerInterface.networkController.roomManager.currentRoom) {
            const room = window.multiplayerInterface.networkController.roomManager.currentRoom;
            const activePlayers = [];
            
            for (let playerId in room.players) {
                const player = room.players[playerId];
                activePlayers.push(player.position);
            }
            
            return activePlayers.sort(); // 确保顺序一致
        }
        
        return []; // 单机模式或无房间信息时返回空数组
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
        
        // 选择棋子
        this.selectedPiece = { x, y, piece };
        
        // 计算可能的移动
        if (this.calculatePossibleMoves) {
            this.possibleMoves = this.calculatePossibleMoves(x, y);
        }
        
        return true;
    }
    
    /**
     * 清除选择
     */
    clearSelection() {
        this.selectedPiece = null;
        this.possibleMoves = [];
    }
    
    /**
     * 尝试移动棋子
     */
    makeMove(fromX, fromY, toX, toY) {
        // 验证移动是否合法
        if (!this.selectedPiece || 
            this.selectedPiece.x !== fromX || 
            this.selectedPiece.y !== fromY) {
            return false;
        }
        
        // 检查目标位置是否在可能移动列表中
        const isValidMove = this.possibleMoves.some(move => 
            move.x === toX && move.y === toY
        );
        
        if (!isValidMove) {
            return false;
        }
        
        // 执行移动
        const success = this.movePiece(fromX, fromY, toX, toY);
        
        if (success) {
            this.clearSelection();
        }
        
        return success;
    }
    
    /**
     * 计算指定棋子的可能移动
     */
    calculatePossibleMoves(x, y) {
        const piece = this.getPiece(x, y);
        if (!piece) return [];
        
        // 这里应该根据不同棋子类型实现具体的移动规则
        // 目前返回空数组，实际实现中会由GameEngine提供
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
        // 检查是否有玩家的王被吃掉
        const eliminatedPlayers = [];
        for (let player = 0; player < 4; player++) {
            let hasKing = false;
            for (let x = 0; x < Config.BOARD_SIZE; x++) {
                for (let y = 0; y < Config.BOARD_SIZE; y++) {
                    const piece = this.getPiece(x, y);
                    if (piece && piece.player === player && piece.type === 'king') {
                        hasKing = true;
                        break;
                    }
                }
                if (hasKing) break;
            }
            if (!hasKing) {
                eliminatedPlayers.push(player);
            }
        }
        
        // 如果只剩一个玩家，游戏结束
        const remainingPlayers = [0, 1, 2, 3].filter(p => !eliminatedPlayers.includes(p));
        if (remainingPlayers.length <= 1) {
            this.gamePhase = 'finished';
            this.winner = remainingPlayers[0] || null;
            return true;
        }
        
        return false;
    }
    
    /**
     * 确定获胜者
     */
    determineWinner(eliminatedPlayers) {
        const remainingPlayers = [0, 1, 2, 3].filter(p => !eliminatedPlayers.includes(p));
        if (remainingPlayers.length === 1) {
            return remainingPlayers[0];
        }
        return null;
    }
    
    /**
     * 重置游戏状态
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
        
        // 重置棋子计数
        this.pieceCounts = {
            0: 10, 1: 10, 2: 10, 3: 10
        };
        
        // 重新初始化棋子
        this.initializePieces();
    }
    
    /**
     * 开始游戏
     */
    startGame() {
        this.gamePhase = 'playing';
        this.currentPlayer = 0; // 红方先行
        this.turn = 1;
        this.moveHistory = [];
        this.winner = null;
        this.clearSelection();
    }
    
    /**
     * 获取游戏统计信息
     */
    getGameStats() {
        return {
            turn: this.turn,
            moveCount: this.moveHistory.length,
            currentPlayer: this.currentPlayer,
            gamePhase: this.gamePhase,
            pieceCounts: { ...this.pieceCounts },
            winner: this.winner
        };
    }
    
    /**
     * 获取游戏信息
     */
    getGameInfo() {
        return {
            currentPlayer: this.currentPlayer,
            gamePhase: this.gamePhase,
            turn: this.turn,
            winner: this.winner,
            pieceCounts: { ...this.pieceCounts },
            moveCount: this.moveHistory.length,
            selectedPiece: this.selectedPiece,
            possibleMoves: [...this.possibleMoves]
        };
    }
    
    /**
     * 获取最后一步移动
     */
    getLastMove() {
        return this.moveHistory.length > 0 ? 
               this.moveHistory[this.moveHistory.length - 1] : null;
    }
    
    /**
     * 悔棋
     */
    undoMove() {
        if (this.moveHistory.length === 0) {
            return false;
        }
        
        const lastMove = this.moveHistory.pop();
        
        // 恢复棋子位置
        const piece = this.getPiece(lastMove.to.x, lastMove.to.y);
        this.removePiece(lastMove.to.x, lastMove.to.y);
        this.setPiece(lastMove.from.x, lastMove.from.y, piece);
        
        // 如果有被吃的棋子，恢复它
        if (lastMove.captured) {
            this.setPiece(lastMove.to.x, lastMove.to.y, lastMove.captured);
            this.pieceCounts[lastMove.captured.player]++;
        }
        
        // 回到上一个玩家
        const clockwiseOrder = [0, 2, 1, 3];
        const currentIndex = clockwiseOrder.indexOf(this.currentPlayer);
        const prevIndex = (currentIndex - 1 + 4) % 4;
        this.currentPlayer = clockwiseOrder[prevIndex];
        
        this.turn--;
        this.clearSelection();
        
        return true;
    }
    
    /**
     * 检查游戏是否结束
     */
    isGameOver() {
        return this.gamePhase === 'finished' || this.winner !== null;
    }
    
    /**
     * 获取棋盘的副本
     */
    getBoardCopy() {
        const copy = [];
        for (let x = 0; x < Config.BOARD_SIZE; x++) {
            copy[x] = [];
            for (let y = 0; y < Config.BOARD_SIZE; y++) {
                const piece = this.board[x][y];
                copy[x][y] = piece ? piece.clone() : null;
            }
        }
        return copy;
    }
    
    /**
     * 从JSON恢复游戏状态
     */
    loadFromJSON(data) {
        this.currentPlayer = data.currentPlayer || 0;
        this.gamePhase = data.gamePhase || 'ready';
        this.turn = data.turn || 1;
        this.winner = data.winner || null;
        this.pieceCounts = data.pieceCounts || { 0: 10, 1: 10, 2: 10, 3: 10 };
        this.moveHistory = data.moveHistory || [];
        
        // 恢复棋盘
        this.board = this.initializeBoard();
        if (data.board) {
            for (let x = 0; x < Config.BOARD_SIZE; x++) {
                for (let y = 0; y < Config.BOARD_SIZE; y++) {
                    if (data.board[x] && data.board[x][y]) {
                        const pieceData = data.board[x][y];
                        const piece = new ChessPiece(
                            pieceData.type,
                            pieceData.player,
                            pieceData.x,
                            pieceData.y
                        );
                        piece.moveCount = pieceData.moveCount || 0;
                        this.board[x][y] = piece;
                    }
                }
            }
        }
        
        this.clearSelection();
    }
    
    /**
     * 转换为JSON格式
     */
    toJSON() {
        return {
            currentPlayer: this.currentPlayer,
            gamePhase: this.gamePhase,
            turn: this.turn,
            winner: this.winner,
            pieceCounts: this.pieceCounts,
            moveHistory: this.moveHistory,
            board: this.board.map(row => 
                row.map(piece => piece ? {
                    type: piece.type,
                    player: piece.player,
                    x: piece.x,
                    y: piece.y,
                    moveCount: piece.moveCount
                } : null)
            )
        };
    }
}

// 棋子类
class ChessPiece {
    constructor(type, player, x, y) {
        this.type = type;       // 棋子类型
        this.player = player;   // 所属玩家 (0-3)
        this.x = x;            // X坐标
        this.y = y;            // Y坐标
        this.moveCount = 0;    // 移动次数
    }
    
    /**
     * 移动棋子到新位置
     */
    moveTo(x, y) {
        this.x = x;
        this.y = y;
        this.moveCount++;
    }
    
    /**
     * 获取棋子的显示符号
     */
    getSymbol() {
        const symbols = {
            'king': ['帅', '将', '帥', '將'],
            'advisor': ['仕', '士', '仕', '士'],
            'elephant': ['相', '象', '相', '象'],
            'horse': ['马', '马', '馬', '馬'],
            'rook': ['车', '车', '車', '車'],
            'cannon': ['炮', '炮', '砲', '砲'],
            'pawn': ['兵', '卒', '兵', '卒']
        };
        
        return symbols[this.type] ? symbols[this.type][this.player] : '?';
    }
    
    /**
     * 克隆棋子
     */
    clone() {
        const cloned = new ChessPiece(this.type, this.player, this.x, this.y);
        cloned.moveCount = this.moveCount;
        return cloned;
    }
    
    /**
     * 比较两个棋子是否相同
     */
    equals(other) {
        return other && 
               this.type === other.type && 
               this.player === other.player && 
               this.x === other.x && 
               this.y === other.y;
    }
    
    /**
     * 获取棋子描述
     */
    toString() {
        const playerNames = ['红', '蓝', '绿', '黑'];
        return `${playerNames[this.player]}${this.getSymbol()}(${this.x},${this.y})`;
    }
}

// 导出类（如果在模块环境中）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GameState, ChessPiece };
}
