// 游戏状态保存管理器
class GameStatePersistence {
    constructor() {
        this.storageKey = 'chess_game_state';
    }
    
    /**
     * 保存游戏状态
     */
    saveGameState(gameState) {
        try {
            const saveData = {
                v: 2,
                timestamp: Date.now(),
                online: !!(typeof window !== 'undefined' && window.onlineSession && window.onlineSession.active),
                rules: gameState.rules,
                gamePhase: gameState.gamePhase,
                currentPlayer: gameState.currentPlayer,
                turn: gameState.turn,
                pieceCounts: gameState.pieceCounts,
                board: gameState.board.map(col => col.map(p => p ? {
                    type: p.type,
                    player: p.player,
                    facing: p.facing || null
                } : null)),
                moveHistory: gameState.moveHistory
            };
            
            localStorage.setItem(this.storageKey, JSON.stringify(saveData));
            return true;
        } catch (error) {
            console.error('Failed to save game state:', error);
            return false;
        }
    }
    
    /**
     * 加载游戏状态
     */
    loadGameState() {
        try {
            const savedData = localStorage.getItem(this.storageKey);
            if (savedData) {
                const parseData = JSON.parse(savedData);
                
                // 检查保存时间（超过24小时的存档自动清理）
                const now = Date.now();
                const saveTime = parseData.timestamp || 0;
                const hoursPassed = (now - saveTime) / (1000 * 60 * 60);
                
                if (hoursPassed > 24) {
                    this.clearSavedState();
                    return null;
                }
                
                return parseData;
            }
        } catch (error) {
            console.error('Failed to load game state:', error);
            this.clearSavedState(); // 清理损坏的存档
        }
        return null;
    }
    
    /**
     * 恢复游戏状态到游戏引擎
     */
    restoreGameState(gameEngine, savedData) {
        try {
            if (!savedData || !gameEngine || !savedData.board) return false;
            
            const gameState = gameEngine.gameState;
            
            // 重建棋盘
            for (let x = 0; x < Config.BOARD_SIZE; x++) {
                for (let y = 0; y < Config.BOARD_SIZE; y++) {
                    const d = savedData.board[x] ? savedData.board[x][y] : null;
                    gameState.board[x][y] = d
                        ? new ChessPiece(d.type, d.player, x, y, d.facing || null)
                        : null;
                }
            }
            
            // 恢复基本状态
            if (savedData.rules) gameState.setRules(savedData.rules);
            gameState.gamePhase = savedData.gamePhase || 'playing';
            gameState.currentPlayer = savedData.currentPlayer || 0;
            gameState.turn = savedData.turn || 1;
            gameState.moveHistory = savedData.moveHistory || [];
            gameState.selectedPiece = null;
            gameState.possibleMoves = [];
            gameState.winner = null;
            
            // 棋子计数：优先用存档，否则按棋盘重算
            if (savedData.pieceCounts) {
                gameState.pieceCounts = Object.assign({ 0: 0, 1: 0, 2: 0, 3: 0 }, savedData.pieceCounts);
            } else {
                gameState.pieceCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
                for (let x = 0; x < Config.BOARD_SIZE; x++) {
                    for (let y = 0; y < Config.BOARD_SIZE; y++) {
                        if (gameState.board[x][y]) gameState.pieceCounts[gameState.board[x][y].player]++;
                    }
                }
            }
            
            gameEngine.isGameActive = gameState.gamePhase === 'playing';
            
            // 更新界面
            gameEngine.updateUI();
            if (gameEngine.boardRenderer) gameEngine.boardRenderer.reset();
            if (gameEngine.updateMoveHistory) gameEngine.updateMoveHistory();
            
            return true;
        } catch (error) {
            console.error('Failed to restore game state:', error);
            return false;
        }
    }
    
    /**
     * 清理保存的状态
     */
    clearSavedState() {
        try {
            localStorage.removeItem(this.storageKey);
        } catch (error) {
            console.error('Failed to clear saved state:', error);
        }
    }
}

// 导出类
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameStatePersistence;
}
