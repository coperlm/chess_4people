// 棋盘渲染器
class BoardRenderer {
    constructor(gameState, pieceManager, ruleValidator) {
        this.gameState = gameState;
        this.pieceManager = pieceManager;
        this.ruleValidator = ruleValidator;
        this.boardElement = document.getElementById('chessBoard');
        this.selectedCell = null;
        
        // 网络模式相关
        this.isNetworkMode = false;
        this.myPlayerPosition = -1;
        
        this.initializeBoard();
        this.bindEvents();
    }
    
    /**
     * 设置网络模式（已移除，保留方法以防调用）
     */
    setNetworkMode(enabled) {
        // 网络模式已移除
        this.isNetworkMode = false;
    }
    
    /**
     * 设置玩家位置（已移除，保留方法以防调用）
     */
    setPlayerPosition(position) {
        // 网络模式已移除
        return;
    }
    
    /**
     * 检查是否可以控制棋子
     */
    canControlPiece(piece) {
        if (!this.isNetworkMode) return true;
        return piece && piece.player === this.myPlayerPosition;
    }
    
    /**
     * 检查是否是当前玩家的回合
     */
    isMyTurn() {
        if (!this.isNetworkMode) return true;
        return this.gameState.currentPlayer === this.myPlayerPosition;
    }
    
    /**
     * 初始化棋盘DOM结构
     */
    initializeBoard() {
        this.boardElement.innerHTML = '';
        
        // 创建11x11的网格
        for (let y = 0; y < Config.BOARD_SIZE; y++) {
            for (let x = 0; x < Config.BOARD_SIZE; x++) {
                const cell = this.createCell(x, y);
                this.boardElement.appendChild(cell);
            }
        }
        
        // 渲染棋子
        this.renderPieces();
    }
    
    /**
     * 创建棋盘格子
     */
    createCell(x, y) {
        const cell = document.createElement('div');
        cell.id = CoordinateMapper.positionToId(x, y);
        cell.className = 'chess-cell';
        cell.dataset.x = x;
        cell.dataset.y = y;
        
        // 设置河界样式
        if (Utils.isRiverPosition(x, y)) {
            cell.classList.add('river');
            cell.innerHTML = '<span class="text-xs text-blue-800 font-bold">河</span>';
        } else if (Utils.isPlayablePosition(x, y)) {
            cell.classList.add('playable');
        }
        
        // 添加九宫格标识线
        if (this.isPalaceCorner(x, y)) {
            this.addPalaceLines(cell, x, y);
        }
        
        return cell;
    }
    
    /**
     * 检查是否是九宫格的角落
     */
    isPalaceCorner(x, y) {
        for (let player = 0; player < 4; player++) {
            const palace = Config.PALACE_AREAS[player];
            if ((x === palace.x[0] || x === palace.x[1]) && 
                (y === palace.y[0] || y === palace.y[1])) {
                return true;
            }
        }
        return false;
    }
    
    /**
     * 添加九宫格对角线
     */
    addPalaceLines(cell, x, y) {
        // 这里可以添加九宫格的对角线标识
        // 暂时用CSS类标识
        cell.classList.add('palace-corner');
    }
    
    /**
     * 渲染所有棋子
     */
    renderPieces() {
        // 清除所有现有棋子
        this.clearAllPieces();
        
        // 重新渲染所有棋子
        for (let x = 0; x < Config.BOARD_SIZE; x++) {
            for (let y = 0; y < Config.BOARD_SIZE; y++) {
                const piece = this.gameState.getPiece(x, y);
                if (piece) {
                    this.renderPiece(piece, x, y);
                }
            }
        }
    }
    
    /**
     * 清除所有棋子
     */
    clearAllPieces() {
        const pieces = this.boardElement.querySelectorAll('.chess-piece');
        pieces.forEach(piece => piece.remove());
    }
    
    /**
     * 渲染单个棋子
     */
    renderPiece(piece, x, y) {
        const cell = document.getElementById(CoordinateMapper.positionToId(x, y));
        if (!cell) return;
        
        // 移除已有棋子
        const existingPiece = cell.querySelector('.chess-piece');
        if (existingPiece) {
            existingPiece.remove();
        }
        
        // 创建棋子元素
        const pieceElement = document.createElement('div');
        pieceElement.className = 'chess-piece';
        pieceElement.dataset.pieceId = piece.id;
        pieceElement.dataset.player = piece.player;
        pieceElement.dataset.type = piece.type;
        
        // 设置棋子样式
        const colorInfo = piece.getColorInfo();
        pieceElement.classList.add(colorInfo.color.replace('text-', 'text-'));
        pieceElement.classList.add(colorInfo.bg);
        pieceElement.classList.add(colorInfo.border);
        
        // 设置棋子文字
        pieceElement.textContent = piece.getName();
        
        // 添加到格子中
        cell.appendChild(pieceElement);
    }
    
    /**
     * 绑定事件
     */
    bindEvents() {
        this.boardElement.addEventListener('click', (e) => {
            this.handleCellClick(e);
        });
    }
    
    /**
     * 处理格子点击事件
     */
    handleCellClick(e) {
        const cell = e.target.closest('.chess-cell');
        if (!cell) return;
        
        // 网络模式下检查是否是自己的回合
        if (this.isNetworkMode && !this.isMyTurn()) {
            Utils.showMessage('现在不是你的回合', 'warning');
            return;
        }
        
        const x = parseInt(cell.dataset.x);
        const y = parseInt(cell.dataset.y);
        
        // 如果点击的是河界，忽略
        if (Utils.isRiverPosition(x, y)) return;
        
        if (this.gameState.selectedPiece) {
            // 已有选中的棋子，尝试移动
            this.handleMove(x, y);
        } else {
            // 选择棋子
            this.handlePieceSelection(x, y);
        }
    }
    
    /**
     * 处理棋子选择
     */
    handlePieceSelection(x, y) {
        const piece = this.gameState.getPiece(x, y);
        
        // 网络模式下只能选择自己的棋子
        if (this.isNetworkMode) {
            if (!piece || !this.canControlPiece(piece)) {
                Utils.showMessage('只能选择自己的棋子', 'warning');
                return;
            }
        } else {
            // 单机模式下只能选择当前玩家的棋子
            if (!piece || piece.player !== this.gameState.currentPlayer) {
                return;
            }
        }
        
        // 选择棋子
        if (this.gameState.selectPiece(x, y)) {
            this.highlightSelectedPiece(x, y);
            this.showPossibleMoves();
        }
    }
    
    /**
     * 处理移动
     */
    handleMove(x, y) {
        const selected = this.gameState.selectedPiece;
        
        // 检查是否点击了同一个棋子（取消选择）
        if (selected.x === x && selected.y === y) {
            this.clearSelection();
            return;
        }
        
        // 检查是否选择了新的己方棋子
        const targetPiece = this.gameState.getPiece(x, y);
        if (targetPiece && targetPiece.player === this.gameState.currentPlayer) {
            this.clearSelection();
            this.handlePieceSelection(x, y);
            return;
        }
        
        // 尝试移动
        if (this.ruleValidator.isValidMove(selected.x, selected.y, x, y)) {
            this.executeMove(selected.x, selected.y, x, y);
        } else {
            Utils.showMessage('无效移动！', 'error');
        }
    }
    
    /**
     * 执行移动
     */
    executeMove(fromX, fromY, toX, toY) {
        try {
            console.log(`🚀 执行移动: (${fromX},${fromY}) -> (${toX},${toY})`);
            
            const piece = this.gameState.getPiece(fromX, fromY);
            const capturedPiece = this.gameState.getPiece(toX, toY);
            
            console.log('移动棋子:', piece ? `${piece.type}(${piece.player})` : 'null');
            console.log('移动前当前玩家:', this.gameState.currentPlayer);
            
            // 执行移动
            if (this.gameState.movePiece(fromX, fromY, toX, toY)) {
                console.log('移动后当前玩家:', this.gameState.currentPlayer);
                
                // 播放移动音效（如果有）
                this.playMoveSound();
                
                // 更新界面
                this.clearSelection();
                this.renderPieces();
                
                // 显示移动信息
                const moveText = Utils.formatMove(piece, fromX, fromY, toX, toY, capturedPiece);
                Utils.showMessage(moveText, 'success');
                
                // 检查游戏是否结束
                if (this.gameState.checkGameEnd()) {
                    this.handleGameEnd();
                }
                
                // 通知游戏引擎更新状态
                if (window.gameEngine) {
                    console.log('📢 通知游戏引擎更新状态');
                    window.gameEngine.onMoveCompleted();
                } else {
                    console.warn('⚠️ window.gameEngine 不存在');
                }
            } else {
                console.log('❌ 移动失败');
            }
        } catch (error) {
            console.error('❌ 执行移动时出错:', error);
            Utils.showMessage('移动执行出错: ' + error.message, 'error');
        }
    }
    
    /**
     * 高亮选中的棋子
     */
    highlightSelectedPiece(x, y) {
        this.clearHighlights();
        
        const cell = document.getElementById(CoordinateMapper.positionToId(x, y));
        const piece = cell.querySelector('.chess-piece');
        
        if (piece) {
            piece.classList.add('selected');
            this.selectedCell = cell;
        }
    }
    
    /**
     * 显示可能的移动
     */
    showPossibleMoves() {
        if (!this.gameState.selectedPiece) return;
        
        const moves = this.ruleValidator.getValidMoves(
            this.gameState.selectedPiece.x,
            this.gameState.selectedPiece.y
        );
        
        moves.forEach(move => {
            const cell = document.getElementById(CoordinateMapper.positionToId(move.x, move.y));
            if (cell) {
                const targetPiece = this.gameState.getPiece(move.x, move.y);
                if (targetPiece) {
                    cell.classList.add('enemy-piece');
                } else {
                    cell.classList.add('possible-move');
                }
            }
        });
        
        this.gameState.possibleMoves = moves;
    }
    
    /**
     * 清除选择状态
     */
    clearSelection() {
        this.gameState.selectedPiece = null;
        this.gameState.possibleMoves = [];
        this.selectedCell = null;
        this.clearHighlights();
    }
    
    /**
     * 清除所有高亮
     */
    clearHighlights() {
        // 清除选中状态
        const selected = this.boardElement.querySelectorAll('.chess-piece.selected');
        selected.forEach(piece => piece.classList.remove('selected'));
        
        // 清除可能移动的高亮
        const highlighted = this.boardElement.querySelectorAll('.possible-move, .enemy-piece');
        highlighted.forEach(cell => {
            cell.classList.remove('possible-move', 'enemy-piece');
        });
    }
    
    /**
     * 处理游戏结束
     */
    handleGameEnd() {
        const winner = this.gameState.winner;
        let message = '';
        
        if (winner === 'TEAM1') {
            message = '红蓝队获胜！';
        } else if (winner === 'TEAM2') {
            message = '绿黑队获胜！';
        } else {
            message = '游戏结束！';
        }
        
        Utils.showMessage(message, 'success');
        
        // 禁用棋盘交互
        this.boardElement.style.pointerEvents = 'none';
    }
    
    /**
     * 播放移动音效
     */
    playMoveSound() {
        // 这里可以添加音效播放逻辑
        // 暂时使用空实现
    }
    
    /**
     * 重置棋盘
     */
    reset() {
        try {
            console.log('🔄 重置棋盘渲染器...');
            
            this.clearSelection();
            console.log('✅ 清除选择状态完成');
            
            if (this.boardElement) {
                this.boardElement.style.pointerEvents = 'auto';
                console.log('✅ 启用棋盘交互');
            } else {
                console.warn('⚠️ boardElement 不存在');
            }
            
            this.renderPieces();
            console.log('✅ 棋盘重置完成');
            
        } catch (error) {
            console.error('❌ 重置棋盘时出错:', error);
            Utils.showMessage(`棋盘重置失败: ${error.message}`, 'error');
        }
    }
    
    /**
     * 更新界面显示
     */
    update() {
        this.renderPieces();
        this.clearHighlights();
    }
    
    /**
     * 高亮最后一步移动
     */
    highlightLastMove() {
        const lastMove = this.gameState.getLastMove();
        if (lastMove) {
            const fromCell = document.getElementById(
                CoordinateMapper.positionToId(lastMove.from.x, lastMove.from.y)
            );
            const toCell = document.getElementById(
                CoordinateMapper.positionToId(lastMove.to.x, lastMove.to.y)
            );
            
            if (fromCell && toCell) {
                fromCell.classList.add('last-move-from');
                toCell.classList.add('last-move-to');
                
                // 3秒后移除高亮
                setTimeout(() => {
                    fromCell.classList.remove('last-move-from');
                    toCell.classList.remove('last-move-to');
                }, 3000);
            }
        }
    }
}

// 导出类（如果在模块环境中）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BoardRenderer;
}
