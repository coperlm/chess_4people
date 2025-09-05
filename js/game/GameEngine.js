// 游戏引擎
class GameEngine {
    constructor() {
        this.gameState = new GameState();
        this.pieceManager = new PieceManager(this.gameState);
        this.ruleValidator = new RuleValidator(this.gameState, this.pieceManager);
        this.boardRenderer = new BoardRenderer(this.gameState, this.pieceManager, this.ruleValidator);
        this.gameInterface = null; // 将在GameInterface中设置
        
        this.isGameActive = false;
        this.gameStartTime = null;
        this.moveTimeout = null;
        
        // 网络模式相关
        this.isNetworkMode = false;
        this.myPlayerPosition = -1;
        this.onMoveCompleted = null;
        this.onGameEnd = null;
        
        this.initialize();
    }
    
    /**
     * 设置网络模式
     */
    setNetworkMode(enabled) {
        this.isNetworkMode = enabled;
        if (this.boardRenderer) {
            this.boardRenderer.setNetworkMode(enabled);
        }
    }
    
    /**
     * 设置玩家位置（网络模式）
     */
    setPlayerPosition(position) {
        this.myPlayerPosition = position;
        if (this.boardRenderer) {
            this.boardRenderer.setPlayerPosition(position);
        }
    }
    
    /**
     * 检查是否是当前玩家的回合
     */
    isMyTurn() {
        if (!this.isNetworkMode) return true;
        return this.gameState.currentPlayer === this.myPlayerPosition;
    }
    
    /**
     * 初始化游戏引擎
     */
    initialize() {
        // 更新规则验证器和棋子管理器的引用
        this.updateReferences();
        
        // 绑定事件
        this.bindEvents();
        
        // 初始化界面
        this.updateUI();
    }
    
    /**
     * 更新对象间的引用关系
     */
    updateReferences() {
        // 更新GameState中的可能移动计算
        this.gameState.calculatePossibleMoves = (x, y) => {
            return this.ruleValidator.getValidMoves(x, y);
        };
        
        // 更新PieceManager中的有效移动获取
        this.pieceManager.getValidMoves = (x, y) => {
            return this.ruleValidator.getValidMoves(x, y);
        };
    }
    
    /**
     * 绑定事件
     */
    bindEvents() {
        // 绑定按钮事件
        const newGameBtn = document.getElementById('newGameBtn');
        const undoBtn = document.getElementById('undoBtn');
        const surrenderBtn = document.getElementById('surrenderBtn');
        
        if (newGameBtn) {
            newGameBtn.addEventListener('click', () => this.startNewGame());
        }
        
        if (undoBtn) {
            undoBtn.addEventListener('click', () => this.undoMove());
        }
        
        if (surrenderBtn) {
            surrenderBtn.addEventListener('click', () => this.surrender());
        }
        
        // 绑定键盘事件
        document.addEventListener('keydown', (e) => this.handleKeyPress(e));
    }
    
    /**
     * 开始新游戏
     */
    startNewGame() {
        this.gameState.reset();
        this.boardRenderer.reset();
        this.isGameActive = true;
        this.gameStartTime = Date.now();
        
        this.gameState.startGame();
        this.updateUI();
        
        Utils.showMessage('新游戏开始！红方先行', 'success');
        
        console.log('游戏开始 - 初始棋盘状态：');
        console.log(this.pieceManager.getBoardText());
    }
    
    /**
     * 悔棋
     */
    undoMove() {
        if (!this.isGameActive || this.gameState.gamePhase !== 'playing') {
            Utils.showMessage('当前无法悔棋', 'warning');
            return;
        }
        
        if (this.gameState.moveHistory.length === 0) {
            Utils.showMessage('没有可悔棋的步数', 'warning');
            return;
        }
        
        if (this.gameState.undoMove()) {
            this.boardRenderer.update();
            this.updateUI();
            Utils.showMessage('已悔棋', 'success');
        } else {
            Utils.showMessage('悔棋失败', 'error');
        }
    }
    
    /**
     * 认输
     */
    surrender() {
        if (!this.isGameActive || this.gameState.gamePhase !== 'playing') {
            return;
        }
        
        const currentPlayer = this.gameState.currentPlayer;
        const playerName = Config.PLAYER_COLORS[currentPlayer].name;
        
        if (confirm(`${playerName}确定要认输吗？`)) {
            this.gameState.gamePhase = 'finished';
            
            // 确定获胜队伍
            if (Config.TEAMS.TEAM1.includes(currentPlayer)) {
                this.gameState.winner = 'TEAM2';
                Utils.showMessage('绿黑队获胜！红蓝队认输', 'success');
            } else {
                this.gameState.winner = 'TEAM1';
                Utils.showMessage('红蓝队获胜！绿黑队认输', 'success');
            }
            
            this.endGame();
        }
    }
    
    /**
     * 移动完成后的处理
     */
    onMoveCompleted() {
        // 更新界面
        this.updateUI();
        
        // 检查将军状态
        this.checkForCheck();
        
        // 检查游戏结束
        if (this.gameState.gamePhase === 'finished') {
            this.endGame();
            return;
        }
        
        // 高亮最后一步移动
        this.boardRenderer.highlightLastMove();
        
        // 更新移动历史显示
        this.updateMoveHistory();
        
        // 网络模式：通知网络控制器
        if (this.isNetworkMode && this.onMoveCompleted) {
            const lastMove = this.gameState.moveHistory[this.gameState.moveHistory.length - 1];
            if (lastMove) {
                this.onMoveCompleted(lastMove);
            }
        }
        
        // 自动保存游戏状态（如果需要）
        this.autoSave();
    }
    
    /**
     * 应用远程移动（网络模式）
     */
    applyMove(moveData) {
        if (!this.isNetworkMode) return;
        
        try {
            // 应用移动到游戏状态
            const success = this.gameState.makeMove(
                moveData.fromX, moveData.fromY,
                moveData.toX, moveData.toY
            );
            
            if (success) {
                this.onMoveCompleted();
            }
        } catch (error) {
            console.error('Failed to apply remote move:', error);
        }
    }
    
    /**
     * 获取当前玩家
     */
    getCurrentPlayer() {
        return this.gameState.currentPlayer;
    }
    
    /**
     * 检查将军状态
     */
    checkForCheck() {
        const currentPlayer = this.gameState.currentPlayer;
        
        if (this.pieceManager.isInCheck(currentPlayer)) {
            const playerName = Config.PLAYER_COLORS[currentPlayer].name;
            
            if (this.pieceManager.isCheckmate(currentPlayer)) {
                // 将死
                Utils.showMessage(`${playerName}被将死！`, 'error');
                this.gameState.gamePhase = 'finished';
                
                // 确定获胜队伍
                if (Config.TEAMS.TEAM1.includes(currentPlayer)) {
                    this.gameState.winner = 'TEAM2';
                } else {
                    this.gameState.winner = 'TEAM1';
                }
            } else {
                // 将军
                Utils.showMessage(`${playerName}被将军！`, 'warning');
            }
        }
    }
    
    /**
     * 结束游戏
     */
    endGame() {
        this.isGameActive = false;
        this.boardRenderer.clearSelection();
        
        // 禁用相关按钮
        const undoBtn = document.getElementById('undoBtn');
        const surrenderBtn = document.getElementById('surrenderBtn');
        
        if (undoBtn) undoBtn.disabled = true;
        if (surrenderBtn) surrenderBtn.disabled = true;
        
        // 显示游戏结果
        this.showGameResult();
        
        // 记录游戏统计
        this.recordGameStats();
    }
    
    /**
     * 显示游戏结果
     */
    showGameResult() {
        const winner = this.gameState.winner;
        let message = '游戏结束！';
        
        if (winner === 'TEAM1') {
            message = '🎉 红蓝队获胜！';
        } else if (winner === 'TEAM2') {
            message = '🎉 绿黑队获胜！';
        }
        
        // 创建结果弹窗
        setTimeout(() => {
            alert(`${message}\n\n总回合数: ${this.gameState.turn - 1}\n游戏时长: ${this.getGameDuration()}`);
        }, 1000);
    }
    
    /**
     * 获取游戏时长
     */
    getGameDuration() {
        if (!this.gameStartTime) return '未知';
        
        const duration = Date.now() - this.gameStartTime;
        const minutes = Math.floor(duration / 60000);
        const seconds = Math.floor((duration % 60000) / 1000);
        
        return `${minutes}分${seconds}秒`;
    }
    
    /**
     * 更新UI界面
     */
    updateUI() {
        this.updateCurrentPlayerDisplay();
        this.updateGameStatus();
        this.updatePieceCount();
        this.updateButtons();
    }
    
    /**
     * 更新当前玩家显示
     */
    updateCurrentPlayerDisplay() {
        const currentPlayerElement = document.getElementById('currentPlayer');
        if (currentPlayerElement) {
            const playerInfo = Config.PLAYER_COLORS[this.gameState.currentPlayer];
            currentPlayerElement.textContent = playerInfo.name;
            currentPlayerElement.className = playerInfo.color;
        }
    }
    
    /**
     * 更新游戏状态显示
     */
    updateGameStatus() {
        const statusElement = document.getElementById('gameStatus');
        if (statusElement) {
            let status = '';
            
            switch (this.gameState.gamePhase) {
                case 'ready':
                    status = '准备开始';
                    break;
                case 'playing':
                    status = `第${this.gameState.turn}回合`;
                    break;
                case 'finished':
                    status = '游戏结束';
                    break;
                default:
                    status = '未知状态';
            }
            
            statusElement.textContent = status;
        }
    }
    
    /**
     * 更新棋子计数显示
     */
    updatePieceCount() {
        const counts = this.gameState.pieceCounts;
        
        ['red', 'blue', 'green', 'black'].forEach((color, index) => {
            const element = document.getElementById(`${color}Pieces`);
            if (element) {
                element.textContent = `${counts[index]}棋子`;
            }
        });
    }
    
    /**
     * 更新按钮状态
     */
    updateButtons() {
        const undoBtn = document.getElementById('undoBtn');
        const surrenderBtn = document.getElementById('surrenderBtn');
        
        const canUndo = this.isGameActive && 
                       this.gameState.gamePhase === 'playing' && 
                       this.gameState.moveHistory.length > 0;
        
        const canSurrender = this.isGameActive && this.gameState.gamePhase === 'playing';
        
        if (undoBtn) undoBtn.disabled = !canUndo;
        if (surrenderBtn) surrenderBtn.disabled = !canSurrender;
    }
    
    /**
     * 更新移动历史显示
     */
    updateMoveHistory() {
        const historyElement = document.getElementById('moveHistory');
        if (!historyElement) return;
        
        const history = this.gameState.moveHistory;
        
        if (history.length === 0) {
            historyElement.innerHTML = '<p class="text-gray-500 text-sm">暂无移动记录</p>';
            return;
        }
        
        // 只显示最近的10步
        const recentMoves = history.slice(-10);
        const htmlContent = recentMoves.map(move => {
            const piece = { player: move.player, type: move.piece };
            const moveText = Utils.formatMove(
                piece, 
                move.from.x, move.from.y, 
                move.to.x, move.to.y, 
                move.captured
            );
            
            const playerColor = Config.PLAYER_COLORS[move.player].color;
            
            return `<div class="text-sm ${playerColor} py-1 border-b border-gray-200">
                        <span class="font-medium">${move.turn}.</span> ${moveText}
                    </div>`;
        }).join('');
        
        historyElement.innerHTML = htmlContent;
        
        // 滚动到底部
        historyElement.scrollTop = historyElement.scrollHeight;
    }
    
    /**
     * 处理键盘事件
     */
    handleKeyPress(e) {
        if (!this.isGameActive) return;
        
        switch (e.key) {
            case 'Escape':
                // 取消选择
                this.boardRenderer.clearSelection();
                break;
            case 'z':
                if (e.ctrlKey) {
                    // Ctrl+Z 悔棋
                    e.preventDefault();
                    this.undoMove();
                }
                break;
            case 'n':
                if (e.ctrlKey) {
                    // Ctrl+N 新游戏
                    e.preventDefault();
                    this.startNewGame();
                }
                break;
        }
    }
    
    /**
     * 自动保存游戏状态
     */
    autoSave() {
        try {
            const gameData = {
                board: this.gameState.board,
                currentPlayer: this.gameState.currentPlayer,
                gamePhase: this.gameState.gamePhase,
                moveHistory: this.gameState.moveHistory,
                turn: this.gameState.turn,
                timestamp: Date.now()
            };
            
            localStorage.setItem('fourPlayerChess_autoSave', JSON.stringify(gameData));
        } catch (error) {
            console.warn('自动保存失败:', error);
        }
    }
    
    /**
     * 记录游戏统计
     */
    recordGameStats() {
        try {
            const stats = {
                winner: this.gameState.winner,
                totalMoves: this.gameState.moveHistory.length,
                gameDuration: this.getGameDuration(),
                endTime: Date.now()
            };
            
            console.log('游戏统计:', stats);
            
            // 这里可以发送到服务器或保存到本地存储
        } catch (error) {
            console.warn('记录统计失败:', error);
        }
    }
    
    /**
     * 获取游戏状态信息
     */
    getGameInfo() {
        return {
            ...this.gameState.getGameInfo(),
            isActive: this.isGameActive,
            duration: this.getGameDuration()
        };
    }
    
    /**
     * 暂停游戏
     */
    pauseGame() {
        this.isGameActive = false;
        // 可以添加暂停相关的UI处理
    }
    
    /**
     * 恢复游戏
     */
    resumeGame() {
        this.isGameActive = true;
        // 可以添加恢复相关的UI处理
    }
}

// 导出类（如果在模块环境中）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameEngine;
}
