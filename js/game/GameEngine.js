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
        
        // 网络模式相关（已移除）
        this.isNetworkMode = false;
        this.controlledColors = null;
        
        // 存档
        this.persistence = new GameStatePersistence();
        
        this.initialize();
    }
    
    /**
     * 设置本端控制的颜色（联机，支持一人多色）
     */
    setControlledColors(colors) {
        this.controlledColors = colors ? colors.slice() : null;
    }
    
    /**
     * 检查游戏组件是否正确初始化
     */
    checkInitialization() {
        const issues = [];
        
        if (!this.gameState) {
            issues.push('GameState 未初始化');
        }
        
        if (!this.pieceManager) {
            issues.push('PieceManager 未初始化');
        }
        
        if (!this.ruleValidator) {
            issues.push('RuleValidator 未初始化');
        }
        
        if (!this.boardRenderer) {
            issues.push('BoardRenderer 未初始化');
        }
        
        // 检查必要的DOM元素
        const requiredElements = ['currentPlayer', 'gameStatus', 'chessBoard'];
        requiredElements.forEach(id => {
            if (!document.getElementById(id)) {
                issues.push(`缺少必要的DOM元素: ${id}`);
            }
        });
        
        if (issues.length > 0) {
            console.error('❌ 游戏初始化检查失败:', issues);
            Utils.showMessage(`游戏初始化不完整:\n${issues.join('\n')}`, 'error');
            return false;
        }
        
        return true;
    }
    
    /**
     * 初始化游戏引擎
     */
    initialize() {
        try {
            
            // 检查初始化状态
            if (!this.checkInitialization()) {
                throw new Error('游戏组件初始化检查失败');
            }
            
            // 更新规则验证器和棋子管理器的引用
            this.updateReferences();
            
            // 绑定事件
            this.bindEvents();
            
            // 初始化界面
            this.updateUI();
            
        } catch (error) {
            console.error('❌ 游戏引擎初始化失败:', error);
            Utils.showMessage(`游戏引擎初始化失败: ${error.message}\n请刷新页面重试`, 'error');
        }
    }
    
    /**
     * 更新对象间的引用关系
     */
    updateReferences() {
        // 显式注入规则验证器：GameState/PieceManager 通过它计算合法走法。
        // 之前用“运行时打补丁”的方式覆写方法，独立调用时会退化为空走法，属隐式契约。
        this.gameState.ruleValidator = this.ruleValidator;
        this.pieceManager.ruleValidator = this.ruleValidator;
    }
    
    /**
     * 绑定事件
     */
    bindEvents() {
        // 绑定按钮事件
        const undoBtn = document.getElementById('undoBtn');
        const surrenderBtn = document.getElementById('surrenderBtn');
        const drawBtn = document.getElementById('drawBtn');

        if (undoBtn) {
            undoBtn.addEventListener('click', () => this.undoMove());
        }

        if (surrenderBtn) {
            surrenderBtn.addEventListener('click', () => this.surrender());
        }

        if (drawBtn) {
            drawBtn.addEventListener('click', () => this.draw());
        }
        
        // 绑定键盘事件
        document.addEventListener('keydown', (e) => this.handleKeyPress(e));
    }
    
    /**
     * 开始新游戏
     */
    startNewGame() {
        // 未做任何设置前不能开局：直接跳到“对局设置”弹窗
        if (window.gameInterface && !window.gameInterface.configured) {
            window.gameInterface.openSetup();
            return;
        }
        if (window.onlineSession && window.onlineSession.active && !window.onlineSession.isHost) {
            Utils.showMessage('只有房主能开新局', 'warning');
            return;
        }
        try {
            // 新开一局：撤销上一局“延迟弹结算面板”的定时器
            if (this._resultTimer) { clearTimeout(this._resultTimer); this._resultTimer = null; }
            
            this.gameState.reset();
            
            // 应用房间规则（本地与联机统一取设置，设置由“对局设置”弹窗维护）
            this.gameState.setRules(window.onlineSession ? window.onlineSession.settings : Config.DEFAULT_RULES);
            
            // 先进入 playing 再渲染，保证起手就高亮当前方
            this.gameState.startGame();
            
            // 新开一局，清掉旧存档
            if (this.persistence) this.persistence.clearSavedState();
            
            this.boardRenderer.reset();
            
            this.isGameActive = true;
            this.gameStartTime = Date.now();
            
            this.updateUI();
            
            Utils.showMessage('新游戏开始！红方先行', 'success');
            if (window.sound) window.sound.play('start');
            
            
            // 联机：房主开局后广播初始局面
            if (window.onlineSession && window.onlineSession.active && window.onlineSession.isHost) {
                window.onlineSession._broadcastState();
            }
            
        } catch (error) {
            console.error('❌ 开始新游戏时出错:', error);
            Utils.showMessage(`开始新游戏失败: ${error.message}\n请刷新页面重试`, 'error');
        }
    }
    
    /**
     * 悔棋
     */
    undoMove() {
        // 任何人（参战玩家）都可悔棋；执行前页内弹窗确认，避免误触（原生 confirm 在微信里会出“关闭网页”）
        if (window.onlineSession && window.onlineSession.active) {
            if (this.gameState.gamePhase !== 'playing') { Utils.showMessage('当前无法悔棋', 'warning'); return; }
            if (this.gameState.moveHistory.length === 0) { Utils.showMessage('没有可悔棋的步数', 'warning'); return; }
            Utils.confirmModal('确定要悔棋吗？').then(ok => { if (ok) window.onlineSession.requestUndo(); });
            return;
        }
        if (!this.isGameActive || this.gameState.gamePhase !== 'playing') {
            Utils.showMessage('当前无法悔棋', 'warning');
            return;
        }

        if (this.gameState.moveHistory.length === 0) {
            Utils.showMessage('没有可悔棋的步数', 'warning');
            return;
        }

        Utils.confirmModal('确定要悔棋吗？').then(ok => {
            if (!ok) return;
            if (this.gameState.undoMove()) {
                if (window.sound) window.sound.play('undo');
                this.boardRenderer.update();
                this.updateUI();
                this.updateMoveHistory();
                Utils.showMessage('已悔棋', 'success');
            } else {
                Utils.showMessage('悔棋失败', 'error');
            }
        });
    }

    /**
     * 求和：本地直接和棋；联机发起/响应求和
     */
    draw() {
        if (window.onlineSession && window.onlineSession.active) {
            window.onlineSession.requestDraw();
            return;
        }
        if (!this.isGameActive || this.gameState.gamePhase !== 'playing') return;
        this.gameState.declareDraw();
        Utils.showMessage('双方同意和棋', 'info');
        this.endGame();
    }
    
    /**
     * 认输
     */
    surrender() {
        if (window.onlineSession && window.onlineSession.active) {
            window.onlineSession.requestResignSelf();
            return;
        }
        if (!this.isGameActive || this.gameState.gamePhase !== 'playing') {
            return;
        }
        
        const currentPlayer = this.gameState.currentPlayer;
        const playerName = Config.PLAYER_COLORS[currentPlayer].name;
        
        Utils.confirmModal(`${playerName}确定要认输吗？`).then(ok => {
            if (!ok) return;
            this.gameState.eliminatePlayer(currentPlayer);
            Utils.showMessage(`${playerName}认输`, 'warning');
            if (this.gameState.checkGameEnd()) {
                this.endGame();
            } else {
                this.gameState.nextPlayer();
                this.boardRenderer.renderPieces();
                this.updateUI();
            }
        });
    }
    
    /**
     * 移动完成后的处理
     */
    onMoveCompleted() {
        try {
            
            // 更新界面
            this.updateUI();
            
            // 统一结算：将被吃 / 困毙（可连锁），并立即重绘界面
            this.resolveAfterMove();
            
            // 结算中若已结束，endGame 已处理
            if (this.gameState.gamePhase === 'finished') return;
            
            // 高亮最后一步移动
            this.boardRenderer.highlightLastMove();
            
            // 更新移动历史显示
            this.updateMoveHistory();
            
            // 自动保存游戏状态（如果需要）
            this.autoSave();
            
        } catch (error) {
            console.error('❌ 移动处理失败:', error);
            Utils.showMessage('移动处理出错: ' + error.message, 'error');
        }
    }
    
    /**
     * 检查将军状态
     */
    /**
     * 每步之后统一结算：将/帅被吃 或 困毙（完全无子可动）一律淘汰，可连锁；并立即重绘界面。
     * 解决两个问题：①困毙卡死；②淘汰后棋子/当前玩家/高亮残留。
     */
    resolveAfterMove() {
        const gs = this.gameState;
        let guard = 0;
        let finished = false;
        let changed = false;              // 是否发生了淘汰（决定淡出与重绘）
        const removed = [];               // 本步被淘汰的颜色（用于淡出特效）
        while (gs.gamePhase === 'playing' && guard++ < 8) {
            // ① 将/帅被直接吃掉的玩家：彻底出局（清残子）并通报（开局移除的颜色除外）
            for (let p = 0; p < 4; p++) {
                if (!gs.hasKing(p) && !gs.eliminationOrder.includes(p) && !gs.outOfPlay.includes(p)) {
                    gs.eliminatePlayer(p);
                    this.notifyKnockout(p, 'captured');
                    removed.push(p); changed = true;
                }
            }
            if (gs.checkGameEnd()) { finished = true; break; }

            // 轮到的玩家若已出局，顺延到下一位再判
            if (!gs.hasKing(gs.currentPlayer)) { gs.nextPlayer(); continue; }

            // ② 困毙/将死：只判“当前该走的一方”——完全无子可动才出局（其余被困者留到各自回合）
            const cur = gs.currentPlayer;
            if (!gs.currentPlayerStuck(this.ruleValidator)) {
                if (this.pieceManager.isInCheck(cur)) {
                    Utils.showBanner('将军', 'check', `${Config.PLAYER_COLORS[cur].name}被将军`);
                    if (window.sound) window.sound.play('check');
                }
                break;
            }
            // 无子可动：被将军者判「将死」，否则「困毙」（仅影响横幅文案，出局逻辑一致）
            const wasInCheck = this.pieceManager.isInCheck(cur);
            gs.eliminatePlayer(cur);
            this.notifyKnockout(cur, wasInCheck ? 'checkmate' : 'stalemate');
            removed.push(cur); changed = true;
            if (gs.checkGameEnd()) { finished = true; break; }
            gs.nextPlayer();
        }
        // 有淘汰：先抓“影子”再重绘，让该方棋子停留一下再淡出，而不是瞬间消失
        if (changed) {
            if (this.boardRenderer.fadeOutPieces) this.boardRenderer.fadeOutPieces(removed);
            this.boardRenderer.renderPieces();
        }
        this.updateUI();
        if (finished) this.endGame();
    }
    
    /**
     * 淘汰通报（本地提示；联机时由房主广播）
     */
    notifyKnockout(player, reason) {
        const name = Config.PLAYER_COLORS[player].name;
        // 淘汰横幅：将帅被吃 / 将死 / 困毙 用棋盘中央的圆形横幅；其余保留普通提示
        const banner = {
            captured: ['将帅被吃', 'danger', '出局'],
            checkmate: ['将死', 'danger', '无路可走'],
            stalemate: ['困毙', 'info', '无子可动']
        }[reason];
        if (banner) {
            Utils.showBanner(banner[0], banner[1], `${name} ${banner[2]}`);
        } else {
            const label = reason === 'kicked' ? '被房主移出'
                : reason === 'resign' ? '认输'
                : '无子可动（困毙）';
            Utils.showMessage(`${name}${label}！`, 'error');
        }
        if (window.onlineSession && window.onlineSession.active && window.onlineSession.isHost) {
            window.onlineSession._broadcastEliminate(player, reason);
        }
    }
    
    /**
     * 结束游戏
     */
    endGame() {
        const wasActive = this.isGameActive;
        this.isGameActive = false;
        if (wasActive && window.sound) window.sound.play('end');
        this.boardRenderer.clearSelection();
        
        // 禁用相关按钮
        const undoBtn = document.getElementById('undoBtn');
        const surrenderBtn = document.getElementById('surrenderBtn');
        
        if (undoBtn) undoBtn.disabled = true;
        if (surrenderBtn) surrenderBtn.disabled = true;
        
        // 稍作停顿再弹结算面板，让“淘汰淡出”动画看得清；重复调用只保留最后一次
        if (this._resultTimer) clearTimeout(this._resultTimer);
        this._resultTimer = setTimeout(() => {
            this._resultTimer = null;
            if (this.gameState.gamePhase !== 'finished') return;   // 期间已重开则不弹
            this.showGameResult();      // 显示游戏结果
            this.recordGameStats();     // 记录游戏统计
        }, 850);
        
        if (window.onlineSession && window.onlineSession.active) {
            window.onlineSession.onGameEnd();
        }
    }
    
    /**
     * 显示游戏结果
     */
    showGameResult() {
        const gs = this.gameState;
        const winner = gs.winner;
        let title = '对局结束';
        if (gs.isDraw) title = '和棋';
        else if (winner === 'TEAM1') title = '红蓝队获胜';
        else if (winner === 'TEAM2') title = '绿黑队获胜';
        else if (typeof winner === 'number' && Config.PLAYER_COLORS[winner]) title = `${Config.PLAYER_COLORS[winner].name}获胜`;

        const el = id => document.getElementById(id);
        const t = el('resultTitle'), b = el('resultBody');
        if (t) t.textContent = title;
        if (b) {
            let html = '';
            if (gs.ranking && gs.ranking.length) {
                html += '<h4>排名</h4><ol>' + gs.ranking.map(k => `<li>${Utils.escapeHtml(this._rankLabel(k))}</li>`).join('') + '</ol>';
            }
            html += `<div>总回合数：${gs.turn - 1}</div>`;
            html += `<div>游戏时长：${Utils.escapeHtml(this.getGameDuration())}</div>`;
            b.innerHTML = html;
        }
        const rb = el('resultReplayBtn');
        if (rb) rb.classList.toggle('hidden', !(gs.moveHistory && gs.moveHistory.length));
        if (window.gameInterface && window.gameInterface.openModal) window.gameInterface.openModal('resultModal');
    }
    
    /**
     * 排名标签
     */
    _rankLabel(key) {
        if (key === 'TEAM1') return '红蓝队';
        if (key === 'TEAM2') return '绿黑队';
        if (typeof key === 'number') return Config.PLAYER_COLORS[key].name;
        if (typeof key === 'string' && /^P\d$/.test(key)) return Config.PLAYER_COLORS[+key.slice(1)].name;
        return String(key);
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
        this.updateCapturedTray();
        this.updateButtons();
        this.updateBoardEnabled();
        this.updateTurnTimer();
        this.updateCheckHighlight();
    }

    /**
     * 被将军的将/帅高亮（棋盘红标），与横幅配套；每端按各自已同步的棋盘计算，结果一致。
     */
    updateCheckHighlight() {
        const br = this.boardRenderer;
        if (!br || !br.setCheckPlayers) return;
        const gs = this.gameState;
        const players = [];
        if (gs.gamePhase === 'playing') {
            for (let p = 0; p < 4; p++) {
                if (gs.hasKing(p) && !gs.eliminationOrder.includes(p) && !gs.outOfPlay.includes(p)
                    && this.pieceManager.isInCheck(p)) players.push(p);
            }
        }
        br.setCheckPlayers(players);
    }

    /**
     * 每步倒计时（仅视觉）：只在“联机对战进行中、且不在回放”时计时。60 秒，剩余 ≤10s 变红（含 0:00 一直保持红），
     * 到点不做任何操作，只轻提示。本地对局 / 回放 / 未开始 都不显示、不计时。
     * 剩余按“本回合开始时间”算差值：房主记开始时间并随快照广播，各端据此对齐；刷新后接着走、不重置回 60。
     */
    updateTurnTimer() {
        const gs = this.gameState;
        const online = !!(window.onlineSession && window.onlineSession.active);
        const inReplay = !!(window.replay && window.replay.active);
        const running = gs.gamePhase === 'playing' && online && !inReplay;
        const key = running ? (gs.currentPlayer + ':' + gs.turn) : 'off';
        if (key === this._timerKey) { this._serverTurnStartedAt = null; return; }
        this._timerKey = key;
        if (this._timerId) { clearInterval(this._timerId); this._timerId = null; }
        if (!running) { this._renderTurnTimer(-1); this._serverTurnStartedAt = null; return; }
        // 本回合开始时间：房主取现在；其余端优先用房主随快照广播来的（刷新/重连能接着走）
        const isHost = !!(window.onlineSession && window.onlineSession.isHost);
        this._turnStartedAt = isHost ? Date.now() : (this._serverTurnStartedAt || Date.now());
        this._serverTurnStartedAt = null;
        const remainOf = () => Math.max(0, 60 - Math.floor((Date.now() - this._turnStartedAt) / 1000));
        this._renderTurnTimer(remainOf());
        this._timerId = setInterval(() => {
            const remain = remainOf();
            this._renderTurnTimer(remain);
            if (remain <= 0) {
                clearInterval(this._timerId); this._timerId = null;
                const p = this.gameState.currentPlayer;
                Utils.showMessage(`该 ${Config.PLAYER_COLORS[p].name} 走棋了`, 'info');
            }
        }, 1000);
    }

    _renderTurnTimer(sec) {
        const el = document.getElementById('turnTimer');
        const row = document.getElementById('turnTimerRow');
        if (sec < 0) {
            if (el) { el.textContent = ''; el.classList.remove('timer--red'); }
            if (row) row.classList.add('hidden');
            return;
        }
        if (row) row.classList.remove('hidden');
        if (!el) return;
        const m = Math.floor(sec / 60), s = sec % 60;
        el.textContent = `${m}:${String(s).padStart(2, '0')}`;
        el.classList.toggle('timer--red', sec <= 10);   // 含 0:00：到点后保持红色
    }
    
    /**
     * 只有对局进行中才允许操作棋盘（回放时由 Replay 接管）
     */
    updateBoardEnabled() {
        const br = this.boardRenderer;
        if (!br || !br.setEnabled) return;
        if (window.replay && window.replay.active) return;
        br.setEnabled(this.gameState.gamePhase === 'playing');
    }
    
    /**
     * 更新当前玩家显示
     */
    updateCurrentPlayerDisplay() {
        try {
            const currentPlayerElement = document.getElementById('currentPlayer');
            if (currentPlayerElement) {
                const currentPlayer = this.gameState.currentPlayer;
                
                const playerInfo = Config.PLAYER_COLORS[currentPlayer];
                if (!playerInfo) {
                    throw new Error(`玩家 ${currentPlayer} 的配置信息不存在`);
                }
                
                currentPlayerElement.textContent = playerInfo.name;
                currentPlayerElement.className = playerInfo.color;
                
            } else {
                console.warn('⚠️ 找不到 currentPlayer 元素');
            }
        } catch (error) {
            console.error('❌ 更新当前玩家显示时出错:', error);
            Utils.showMessage(`更新玩家显示失败: ${error.message}`, 'error');
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
                    status = '等待开始（点击『新游戏』）';
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
                element.textContent = counts[index];
            }
        });
    }
    
    /**
     * 更新按钮状态
     */
    updateButtons() {
        const undoBtn = document.getElementById('undoBtn');
        const surrenderBtn = document.getElementById('surrenderBtn');
        const drawBtn = document.getElementById('drawBtn');

        // 观战者（联机中无颜色者）不能悔棋/认输/求和
        const os = window.onlineSession;
        const spectator = !!(os && os.active && (!os.myColors || !os.myColors.length));
        const playing = this.isGameActive && this.gameState.gamePhase === 'playing'
            && !(window.replay && window.replay.active);   // 回放中禁用“悔棋/认输/求和”（此时 gameState 仍是实时对局）

        const canUndo = playing && this.gameState.moveHistory.length > 0 && !spectator;
        const canSurrender = playing && !spectator;

        if (undoBtn) undoBtn.disabled = !canUndo;
        if (surrenderBtn) surrenderBtn.disabled = !canSurrender;
        if (drawBtn) drawBtn.disabled = !canSurrender;
    }
    
    /**
     * 更新移动历史显示
     */
    updateMoveHistory() {
        const historyElement = document.getElementById('moveHistory');
        if (!historyElement) return;

        const history = this.gameState.moveHistory;
        const undoLog = this.gameState.undoLog || [];

        if (history.length === 0 && undoLog.length === 0) {
            historyElement.innerHTML = '<p class="text-gray-500 text-sm">暂无移动记录</p>';
            return;
        }

        const parts = [];
        // 走子（最新在上）
        history.slice().reverse().forEach(move => {
            const cls = Config.PLAYER_COLORS[move.player].color;
            parts.push(`<div class="text-sm ${cls}">${Notation.format(move)}</div>`);
        });
        // 悔棋记录（单独列出，最新在上）
        if (undoLog.length) {
            parts.push('<div class="move-subhead">悔棋记录</div>');
            undoLog.slice().reverse().forEach(u => {
                const cls = Config.PLAYER_COLORS[u.player].color;
                parts.push(`<div class="text-sm move-line--undo ${cls}">↩ ${Notation.format(u)}</div>`);
            });
        }
        historyElement.innerHTML = parts.join('');
        historyElement.scrollTop = 0;
    }

    /**
     * 吃子托盘：由走子历史派生被吃棋子，按“被吃方颜色”分组展示
     */
    updateCapturedTray() {
        const el = document.getElementById('capturedTray');
        if (!el) return;
        const captured = this.gameState.moveHistory.filter(m => m.captured).map(m => m.captured);
        if (!captured.length) { el.innerHTML = ''; return; }
        const byPlayer = { 0: [], 1: [], 2: [], 3: [] };
        captured.forEach(c => { if (byPlayer[c.player]) byPlayer[c.player].push(c.type); });
        let html = '';
        for (const p of [0, 1, 2, 3]) {
            if (!byPlayer[p].length) continue;
            const glyphs = byPlayer[p].map(t => `<span class="cap cap--${p}">${Config.PIECE_NAMES[p][t]}</span>`).join('');
            html += `<div class="cap-row"><span class="cap-label">${Config.PLAYER_COLORS[p].name}被吃</span>${glyphs}</div>`;
        }
        el.innerHTML = html;
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
                    // Ctrl+N 与「新游戏」按钮一致：打开对局设置
                    e.preventDefault();
                    if (window.gameInterface && window.gameInterface.openSetup) window.gameInterface.openSetup();
                }
                break;
        }
    }
    
    /**
     * 自动保存游戏状态
     */
    autoSave() {
        try {
            if (!this.persistence) this.persistence = new GameStatePersistence();
            this.persistence.saveGameState(this.gameState, this.gameStartTime);
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
}

// 导出类（如果在模块环境中）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameEngine;
}
