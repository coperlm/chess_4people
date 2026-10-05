// 游戏状态保存管理器（localStorage）
// 存档格式 v3：紧凑化——棋盘只存有子的格子、走子/悔棋用数组；棋子计数改为恢复时重算。
// 兼容读取 v2（board 为 10×10 嵌套对象）。
class GameStatePersistence {
    constructor() {
        this.storageKey = 'chess_game_state';
    }

    /**
     * 保存游戏状态（紧凑格式）
     */
    saveGameState(gameState, startedAt) {
        try {
            const pieces = [];
            for (let x = 0; x < Config.BOARD_SIZE; x++) {
                for (let y = 0; y < Config.BOARD_SIZE; y++) {
                    const p = gameState.board[x][y];
                    if (p) pieces.push([x, y, p.type, p.player, p.facing || 0]);
                }
            }
            const moves = gameState.moveHistory.map(m => [
                m.player, m.piece, m.from.x, m.from.y, m.to.x, m.to.y,
                m.captured ? m.captured.player : -1, m.captured ? m.captured.type : -1
            ]);
            const undos = (gameState.undoLog || []).map(m => [
                m.player, m.piece, m.from.x, m.from.y, m.to.x, m.to.y, m.atMove || 0
            ]);

            const saveData = {
                v: 3,
                timestamp: Date.now(),
                online: !!(typeof window !== 'undefined' && window.onlineSession && window.onlineSession.active),
                rules: gameState.rules,
                gamePhase: gameState.gamePhase,
                currentPlayer: gameState.currentPlayer,
                turn: gameState.turn,
                gameStartTime: startedAt || null,   // 本局开始时间（用于“游戏时长”）
                winner: gameState.winner === undefined ? null : gameState.winner,
                isDraw: !!gameState.isDraw,
                ranking: gameState.ranking || null,
                eliminationOrder: gameState.eliminationOrder || [],
                eliminationLog: gameState.eliminationLog || [],
                pieces,   // [[x,y,type,player,facing]]
                moves,    // [[player,piece,fx,fy,tx,ty,capPlayer,capType]]
                undos     // [[player,piece,fx,fy,tx,ty,atMove]]
            };

            localStorage.setItem(this.storageKey, JSON.stringify(saveData));
            return true;
        } catch (error) {
            console.error('Failed to save game state:', error);
            return false;
        }
    }

    /**
     * 加载存档（超 24 小时自动清理）
     */
    loadGameState() {
        try {
            const savedData = localStorage.getItem(this.storageKey);
            if (!savedData) return null;
            const parseData = JSON.parse(savedData);
            const hoursPassed = (Date.now() - (parseData.timestamp || 0)) / (1000 * 60 * 60);
            if (hoursPassed > 24) { this.clearSavedState(); return null; }
            return parseData;
        } catch (error) {
            console.error('Failed to load game state:', error);
            this.clearSavedState();
            return null;
        }
    }

    /**
     * 恢复存档到游戏引擎（兼容 v2/v3）
     */
    restoreGameState(gameEngine, savedData) {
        try {
            if (!savedData || !gameEngine || (!savedData.pieces && !savedData.board)) return false;
            const gs = gameEngine.gameState;

            // 清空并重建棋盘
            for (let x = 0; x < Config.BOARD_SIZE; x++) {
                for (let y = 0; y < Config.BOARD_SIZE; y++) gs.board[x][y] = null;
            }
            if (savedData.pieces) {
                for (const [x, y, type, player, facing] of savedData.pieces) {
                    if (Utils.isValidPosition(x, y)) gs.board[x][y] = new ChessPiece(type, player, x, y, facing || null);
                }
            } else {
                // v2 兼容
                for (let x = 0; x < Config.BOARD_SIZE; x++) {
                    for (let y = 0; y < Config.BOARD_SIZE; y++) {
                        const d = savedData.board[x] ? savedData.board[x][y] : null;
                        gs.board[x][y] = d ? new ChessPiece(d.type, d.player, x, y, d.facing || null) : null;
                    }
                }
            }

            // 基本状态
            if (savedData.rules) gs.setRules(savedData.rules);
            gs.gamePhase = savedData.gamePhase || 'playing';
            gs.currentPlayer = savedData.currentPlayer || 0;
            gs.turn = savedData.turn || 1;
            gs.winner = savedData.winner === undefined ? null : savedData.winner;
            gs.isDraw = !!savedData.isDraw;
            gs.ranking = savedData.ranking || null;
            gs.eliminationOrder = savedData.eliminationOrder || [];
            gs.eliminationLog = savedData.eliminationLog || [];

            // 走子历史（还原为内存中的“富对象”）
            if (Array.isArray(savedData.moves)) {
                gs.moveHistory = savedData.moves.map(a => ({
                    player: a[0], piece: a[1],
                    from: { x: a[2], y: a[3] }, to: { x: a[4], y: a[5] },
                    captured: a[6] >= 0 ? { player: a[6], type: a[7] } : null
                }));
            } else {
                gs.moveHistory = (savedData.moveHistory || []).map(mv => ({
                    player: mv.player, piece: mv.piece,
                    from: { x: mv.from.x, y: mv.from.y }, to: { x: mv.to.x, y: mv.to.y },
                    captured: mv.captured || null
                }));
            }
            gs.undoLog = Array.isArray(savedData.undos) ? savedData.undos.map(a => ({
                player: a[0], piece: a[1],
                from: { x: a[2], y: a[3] }, to: { x: a[4], y: a[5] },
                atMove: a[6]
            })) : [];

            // 棋子计数：按棋盘重算（存档不再冗余保存）
            gs.pieceCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
            for (let x = 0; x < Config.BOARD_SIZE; x++) {
                for (let y = 0; y < Config.BOARD_SIZE; y++) {
                    if (gs.board[x][y]) gs.pieceCounts[gs.board[x][y].player]++;
                }
            }

            gs.selectedPiece = null;
            gs.possibleMoves = [];
            gameEngine.isGameActive = gs.gamePhase === 'playing';
            gameEngine.gameStartTime = savedData.gameStartTime || Date.now();

            gameEngine.updateUI();
            if (gameEngine.boardRenderer) gameEngine.boardRenderer.reset();
            if (gameEngine.updateMoveHistory) gameEngine.updateMoveHistory();
            return true;
        } catch (error) {
            console.error('Failed to restore game state:', error);
            return false;
        }
    }

    clearSavedState() {
        try { localStorage.removeItem(this.storageKey); }
        catch (error) { console.error('Failed to clear saved state:', error); }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameStatePersistence;
}
