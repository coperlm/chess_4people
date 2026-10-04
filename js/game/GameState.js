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
        
        // 房间规则（模式 / 胜利条件 / 友伤）
        this.rules = Object.assign({}, Config.DEFAULT_RULES);
        this.eliminationOrder = []; // 被淘汰玩家的先后顺序
        this.eliminationLog = [];   // [{player, atMove}] 淘汰事件（用回放记录）
        this.ranking = null;        // 结算排名（从高到低）
        
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
                const piece = new ChessPiece(pos.type, player, pos.x, pos.y, pos.facing || null);
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
     * 设置房间规则
     */
    setRules(rules) {
        this.rules = Object.assign({}, Config.DEFAULT_RULES, rules || {});
        if (this.rules.mode === Config.MODES.FFA) {
            this.rules.victory = Config.VICTORY.LAST_TEAM; // 混战固定“仅剩一人”
        }
    }
    
    /**
     * 玩家所属阵营键：组队模式为 TEAM1/TEAM2，混战模式为 P0..P3
     */
    teamKey(player) {
        if (this.rules.mode === Config.MODES.FFA) return 'P' + player;
        return Config.TEAMS.TEAM1.includes(player) ? 'TEAM1' : 'TEAM2';
    }
    
    /**
     * 是否队友（混战模式无队友）
     */
    isTeammate(a, b) {
        if (a === b) return false;
        if (this.rules.mode === Config.MODES.FFA) return false;
        return this.teamKey(a) === this.teamKey(b);
    }
    
    /**
     * 是否敌人
     */
    isEnemy(a, b) {
        return a !== b && !this.isTeammate(a, b);
    }
    
    /**
     * 能否吃掉目标（友伤开启时允许吃队友）
     */
    canCaptureTarget(attacker, target) {
        if (attacker === target) return false;
        if (this.isEnemy(attacker, target)) return true;
        return this.isTeammate(attacker, target) && !!this.rules.friendlyFire;
    }
    
    /**
     * 某玩家是否还有将/帅在场
     */
    hasKing(player) {
        for (let x = 0; x < Config.BOARD_SIZE; x++) {
            for (let y = 0; y < Config.BOARD_SIZE; y++) {
                const pc = this.board[x][y];
                if (pc && pc.player === player && pc.type === Config.PIECE_TYPES.KING) return true;
            }
        }
        return false;
    }
    
    /**
     * 淘汰一名玩家（移除其全部棋子）
     */
    eliminatePlayer(player) {
        for (let x = 0; x < Config.BOARD_SIZE; x++) {
            for (let y = 0; y < Config.BOARD_SIZE; y++) {
                const pc = this.board[x][y];
                if (pc && pc.player === player) this.board[x][y] = null;
            }
        }
        this.pieceCounts[player] = 0;
        if (!this.eliminationOrder.includes(player)) this.eliminationOrder.push(player);
        if (!this.eliminationLog.some(e => e.player === player)) {
            this.eliminationLog.push({ player, atMove: this.moveHistory.length });
        }
    }
    
    /**
     * 切换到下一个玩家（顺时针轮转；跳过已被淘汰者）
     */
    nextPlayer() {
        // 顺时针轮转顺序：红(0) → 绿(2) → 蓝(1) → 黑(3)
        const clockwiseOrder = [0, 2, 1, 3];
        const currentIndex = clockwiseOrder.indexOf(this.currentPlayer);
        for (let step = 1; step <= 4; step++) {
            const cand = clockwiseOrder[(currentIndex + step) % 4];
            if (this.hasKing(cand) || step === 4) { this.currentPlayer = cand; break; }
        }
        
        this.selectedPiece = null;
        this.possibleMoves = [];
        this.turn++;
    }
    
    /**
     * 检查游戏是否结束
     */
    checkGameEnd() {
        // 记录淘汰顺序
        for (let p = 0; p < 4; p++) {
            if (!this.hasKing(p) && !this.eliminationOrder.includes(p)) {
                this.eliminationOrder.push(p);
            }
        }
        
        const alive = [0, 1, 2, 3].filter(p => this.hasKing(p));
        
        if (this.rules.mode === Config.MODES.FFA) {
            if (alive.length <= 1) {
                this.gamePhase = 'finished';
                this.winner = alive.length === 1 ? alive[0] : null;
                this.ranking = alive.slice().concat(this.eliminationOrder.slice().reverse());
                return true;
            }
            return false;
        }
        
        // 两两组队
        const aliveTeams = new Set(alive.map(p => this.teamKey(p)));
        
        if (this.rules.victory === Config.VICTORY.ANY_KING) {
            if (this.eliminationOrder.length > 0) {
                const lostTeam = this.teamKey(this.eliminationOrder[0]);
                this.gamePhase = 'finished';
                this.winner = lostTeam === 'TEAM1' ? 'TEAM2' : 'TEAM1';
                this.ranking = [this.winner, this.winner === 'TEAM1' ? 'TEAM2' : 'TEAM1'];
                return true;
            }
            return false;
        }
        
        // 仅剩一队
        if (aliveTeams.size <= 1) {
            this.gamePhase = 'finished';
            this.winner = aliveTeams.size === 1 ? [...aliveTeams][0] : null;
            this.ranking = this.winner ? [this.winner, this.winner === 'TEAM1' ? 'TEAM2' : 'TEAM1'] : [];
            return true;
        }
        return false;
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
        this.eliminationOrder = [];
        this.eliminationLog = [];
        this.ranking = null;
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
    constructor(type, player, x, y, facing = null) {
        this.type = type;
        this.player = player;
        this.x = x;
        this.y = y;
        this.facing = facing; // 兵/卒的固定朝向：'up'|'down'|'left'|'right'（由初始格决定）
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
