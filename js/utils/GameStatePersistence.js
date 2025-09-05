// 游戏状态保存管理器
class GameStatePersistence {
    constructor() {
        this.storageKey = 'chess_game_state';
        this.autoSaveInterval = null;
    }
    
    /**
     * 保存游戏状态
     */
    saveGameState(gameState, roomInfo = null) {
        try {
            const saveData = {
                timestamp: Date.now(),
                gamePhase: gameState.gamePhase,
                currentPlayer: gameState.currentPlayer,
                board: gameState.board,
                moveHistory: gameState.moveHistory,
                capturedPieces: gameState.capturedPieces,
                selectedPiece: gameState.selectedPiece,
                possibleMoves: gameState.possibleMoves,
                roomInfo: roomInfo
            };
            
            localStorage.setItem(this.storageKey, JSON.stringify(saveData));
            console.log('Game state saved successfully');
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
            if (!savedData || !gameEngine) return false;
            
            const gameState = gameEngine.gameState;
            
            // 恢复基本状态
            gameState.gamePhase = savedData.gamePhase || 'playing';
            gameState.currentPlayer = savedData.currentPlayer || 0;
            gameState.moveHistory = savedData.moveHistory || [];
            gameState.capturedPieces = savedData.capturedPieces || [];
            
            // 恢复棋盘状态
            if (savedData.board) {
                for (let x = 0; x < Config.BOARD_SIZE; x++) {
                    for (let y = 0; y < Config.BOARD_SIZE; y++) {
                        if (savedData.board[x] && savedData.board[x][y]) {
                            const pieceData = savedData.board[x][y];
                            gameState.board[x][y] = new ChessPiece(
                                pieceData.type, 
                                pieceData.player, 
                                x, 
                                y
                            );
                        }
                    }
                }
            }
            
            // 更新界面
            gameEngine.updateUI();
            gameEngine.boardRenderer.renderPieces();
            
            console.log('Game state restored successfully');
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
            console.log('Saved game state cleared');
        } catch (error) {
            console.error('Failed to clear saved state:', error);
        }
    }
    
    /**
     * 检查是否有保存的游戏
     */
    hasSavedGame() {
        const savedData = this.loadGameState();
        return savedData !== null;
    }
    
    /**
     * 开始自动保存
     */
    startAutoSave(gameEngine, interval = 30000) { // 默认30秒
        this.stopAutoSave();
        
        this.autoSaveInterval = setInterval(() => {
            if (gameEngine && gameEngine.isGameActive) {
                this.saveGameState(gameEngine.gameState);
            }
        }, interval);
        
        console.log(`Auto-save started with ${interval/1000}s interval`);
    }
    
    /**
     * 停止自动保存
     */
    stopAutoSave() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
            this.autoSaveInterval = null;
            console.log('Auto-save stopped');
        }
    }
    
    /**
     * 获取存档信息
     */
    getSaveInfo() {
        const savedData = this.loadGameState();
        if (savedData) {
            return {
                saveTime: new Date(savedData.timestamp),
                currentPlayer: savedData.currentPlayer,
                moveCount: savedData.moveHistory ? savedData.moveHistory.length : 0,
                gamePhase: savedData.gamePhase
            };
        }
        return null;
    }
    
    /**
     * 导出游戏状态（用于分享或备份）
     */
    exportGameState() {
        const savedData = this.loadGameState();
        if (savedData) {
            return btoa(JSON.stringify(savedData)); // Base64编码
        }
        return null;
    }
    
    /**
     * 导入游戏状态
     */
    importGameState(encodedData) {
        try {
            const decodedData = JSON.parse(atob(encodedData)); // Base64解码
            localStorage.setItem(this.storageKey, JSON.stringify(decodedData));
            return true;
        } catch (error) {
            console.error('Failed to import game state:', error);
            return false;
        }
    }
}

// 导出类
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameStatePersistence;
}
