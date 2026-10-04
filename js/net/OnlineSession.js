// 联机对局（Trystero 免服务器 P2P，房主权威 + 各端复核）
// - 房主：持有权威 GameState/RuleValidator，校验并广播“走子”
// - 玩家：收到走子后，用同一套 RuleValidator 复核再落子；非法则拒绝并要求重同步
// - 房主刷新：凭本地 token/记录自动重连同房间并续局；房主失联超时则由在线玩家自动接任
const ONLINE_FAILOVER_MS = 20000;

class OnlineSession {
    constructor(gameEngine) {
        this.gameEngine = gameEngine;
        this.appId = 'chess-4people-v1';
        this.RECORD_KEY = 'chess_online_room';
        this.TOKEN_KEY = 'chess_online_token';

        this.room = null;
        this.roomId = null;
        this.isHost = false;
        this.active = false;
        this.started = false;
        this.selfId = null;
        this.hostId = null;
        this.token = '';
        this.myColors = [];
        this.name = '';
        this.settings = Object.assign({}, Config.DEFAULT_RULES);
        this.participants = [];   // 房主维护：[{ token, id, colors:[], name }]
        this._roster = null;      // 玩家侧名册
        this.seq = 0;
        this._lastSeq = 0;
        this._bound = false;
        this._resuming = false;
        this._failoverTimer = null;
    }

    // ================= 初始化 =================
    init() {
        if (this._bound || typeof document === 'undefined') return;
        this._bound = true;
        const $ = id => document.getElementById(id);
        this.el = {
            code: $('roomCodeInput'),
            name: $('playerNameInput'),
            mode: $('modeSelect'),
            victory: $('victorySelect'),
            ff: $('friendlyFireCheck'),
            create: $('createRoomBtn'),
            join: $('joinRoomBtn'),
            copy: $('copyInviteBtn'),
            status: $('onlineStatus'),
            roster: $('onlineRoster'),
            start: $('startOnlineBtn'),
            leave: $('leaveRoomBtn')
        };
        if (this.el.mode) this.el.mode.addEventListener('change', () => { this._readSettingsFromUI(); this._syncSettingsUI(); this._updateStartBtn(); });
        if (this.el.victory) this.el.victory.addEventListener('change', () => { this._readSettingsFromUI(); this._broadcastRoster(); });
        if (this.el.ff) this.el.ff.addEventListener('change', () => { this._readSettingsFromUI(); this._broadcastRoster(); });
        if (this.el.name) this.el.name.addEventListener('change', () => {
            this.name = this.el.name.value.trim();
            if (this.active && !this.isHost) this._sendHello();
        });
        if (this.el.create) this.el.create.addEventListener('click', () => this._onCreate());
        if (this.el.join) this.el.join.addEventListener('click', () => this._onJoin());
        if (this.el.copy) this.el.copy.addEventListener('click', () => this._copyInvite());
        if (this.el.start) this.el.start.addEventListener('click', () => this.startMatch());
        if (this.el.leave) this.el.leave.addEventListener('click', () => this.leave());
        this._syncSettingsUI();
    }

    _readSettingsFromUI() {
        if (!this.el) return;
        if (this.el.mode) this.settings.mode = this.el.mode.value;
        if (this.settings.mode === Config.MODES.FFA) {
            this.settings.victory = Config.VICTORY.LAST_TEAM;
        } else {
            if (this.el.victory) this.settings.victory = this.el.victory.value;
            if (this.el.ff) this.settings.friendlyFire = !!this.el.ff.checked;
        }
    }
    _syncSettingsUI() {
        if (!this.el) return;
        const ffa = this.settings.mode === Config.MODES.FFA;
        const locked = this.active && !this.isHost; // 只有“在房间里且非房主”才锁定，未联机时可自由设置
        if (this.el.mode) { this.el.mode.value = this.settings.mode; this.el.mode.disabled = locked; }
        if (this.el.victory) { this.el.victory.value = this.settings.victory; this.el.victory.disabled = locked || ffa; }
        if (this.el.ff) { this.el.ff.checked = !!this.settings.friendlyFire; this.el.ff.disabled = locked || ffa; }
    }

    // ================= token / 记录 =================
    _loadToken() {
        try {
            let t = localStorage.getItem(this.TOKEN_KEY);
            if (!t) { t = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(this.TOKEN_KEY, t); }
            return t;
        } catch (e) { return 'tok' + Math.random().toString(36).slice(2); }
    }
    _saveRecord() {
        if (!this.active) return;
        try {
            localStorage.setItem(this.RECORD_KEY, JSON.stringify({
                roomId: this.roomId,
                isHost: this.isHost,
                token: this.token,
                started: this.started,
                settings: this.settings,
                roster: this.isHost ? this.participants.map(p => ({ token: p.token, name: p.name, colors: p.colors })) : undefined,
                seq: this.seq,
                savedAt: Date.now()
            }));
        } catch (e) { /* ignore */ }
    }
    _clearRecord() {
        try { localStorage.removeItem(this.RECORD_KEY); } catch (e) { /* ignore */ }
    }
    _loadRecord() {
        try { return JSON.parse(localStorage.getItem(this.RECORD_KEY) || 'null'); } catch (e) { return null; }
    }

    /**
     * 页面加载时调用：若有近期联机记录则自动重连续局
     * @returns {boolean} 是否已尝试恢复
     */
    resumeIfAny() {
        const rec = this._loadRecord();
        if (!rec || !rec.roomId) return false;
        if (Date.now() - (rec.savedAt || 0) > 2 * 60 * 60 * 1000) { this._clearRecord(); return false; }
        this._resuming = true;
        this.settings = Object.assign({}, Config.DEFAULT_RULES, rec.settings || {});
        this.token = rec.token || this._loadToken();
        this._open(rec.roomId, !!rec.isHost, rec);
        return true;
    }

    // ================= 房间创建 / 加入 =================
    _genCode() {
        const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
        let s = '';
        for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
        return s;
    }
    _randomId() {
        const hex = '0123456789abcdef';
        let s = '';
        for (let i = 0; i < 6; i++) s += hex[Math.floor(Math.random() * 16)];
        return s;
    }
    _validCode(c) { return /^[a-z0-9]{3,8}$/i.test(c || ''); }

    _inviteLink() { return `${location.origin}${location.pathname}?room=${this.roomId}`; }
    _copyInvite() {
        const link = this._inviteLink();
        const manual = () => this._setStatus('请手动复制邀请链接：' + link, 'ok');
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(link).then(() => this._setStatus('邀请链接已复制：' + link, 'ok')).catch(manual);
            } else manual();
        } catch (e) { manual(); }
    }

    /**
     * 通过 ?room=xxx 直接加入（分享链接用）
     */
    autoJoinFromUrl() {
        try {
            const room = new URLSearchParams(location.search).get('room');
            if (!room || !this._validCode(room)) return false;
            if (this.el && this.el.code) this.el.code.value = room;
            this._open(room.toLowerCase(), false);
            return true;
        } catch (e) { return false; }
    }

    _onCreate() {
        const code = (this.el && this.el.code && this.el.code.value.trim()) || this._genCode();
        if (!this._validCode(code)) return this._setStatus('房间号需为 3-8 位字母或数字', 'error');
        if (this.el && this.el.code) this.el.code.value = code;
        this._open(code.toLowerCase(), true);
    }
    _onJoin() {
        const code = (this.el && this.el.code && this.el.code.value.trim()) || '';
        if (!this._validCode(code)) return this._setStatus('请输入正确的房间号', 'error');
        this._open(code.toLowerCase(), false);
    }

    _open(roomId, isHost, record) {
        if (typeof Trystero === 'undefined' || !Trystero.joinRoom) {
            this._setStatus('联机组件未加载（vendor/trystero.nostr.iife.js）', 'error');
            return;
        }
        this.leave();

        this.roomId = roomId;
        this.isHost = isHost;
        this.active = true;
        this.seq = 0;
        this._lastSeq = 0;
        this.myColors = [];
        this.participants = [];
        this.token = this.token || this._loadToken();
        this.name = (this.el && this.el.name && this.el.name.value.trim()) || this.name || this._randomId();
        if (!this._resuming) { this.started = false; if (isHost) this._readSettingsFromUI(); }

        try {
            this.room = Trystero.joinRoom({ appId: this.appId, password: this.roomId }, this.roomId);
        } catch (e) {
            this.active = false;
            this._setStatus('加入房间失败: ' + (e && e.message), 'error');
            return;
        }
        this.selfId = this.room.selfId || Trystero.selfId;

        this.actHello = this.room.makeAction('hello');
        this.actAssign = this.room.makeAction('assign');
        this.actRoster = this.room.makeAction('roster');
        this.actIntent = this.room.makeAction('intent');
        this.actMove = this.room.makeAction('move');
        this.actUndo = this.room.makeAction('undo');
        this.actEliminate = this.room.makeAction('eliminate');
        this.actState = this.room.makeAction('state');
        this.actNotice = this.room.makeAction('notice');

        this.actHello.onMessage = (d, ctx) => this._onHello(d, ctx.peerId);
        this.actAssign.onMessage = d => this._onAssign(d);
        this.actRoster.onMessage = d => this._onRoster(d);
        this.actState.onMessage = d => this._onState(d);
        this.actNotice.onMessage = d => this._onNotice(d);
        this.actIntent.onMessage = (d, ctx) => this._onIntent(d, ctx.peerId);
        this.actMove.onMessage = d => this._onMove(d);
        this.actUndo.onMessage = d => this._onUndo(d);
        this.actEliminate.onMessage = d => this._onEliminate(d);

        this.room.onPeerJoin = id => this._onPeerJoin(id);
        this.room.onPeerLeave = id => this._onPeerLeave(id);

        if (isHost) {
            this.hostId = this.selfId;
            const roster = (record && record.roster) || [];
            this.participants = [{ token: this.token, id: this.selfId, colors: [], name: this.name }];
            for (const r of roster) {
                if (r.token === this.token) continue;
                this.participants.push({ token: r.token, id: null, colors: r.colors || [], name: r.name || '' });
            }
            if (this._resuming) {
                this.started = !!(record && record.started);
                this.settings = Object.assign({}, Config.DEFAULT_RULES, (record && record.settings) || {});
                // 恢复本局棋盘（权威状态）
                const saved = this.gameEngine.persistence.loadGameState();
                if (saved && saved.gamePhase === 'playing') {
                    this.gameEngine.persistence.restoreGameState(this.gameEngine, saved);
                    this.gameEngine.gameState.setRules(this.settings);
                    this.gameEngine.isGameActive = true;
                } else {
                    this.started = false; // 游戏已结束，退回到等待开局
                }
                this._setStatus(`已恢复房间「${this.roomId}」，等待玩家重连…`, 'ok');
                // 重连后把当前局面推给已连接的玩家
                setTimeout(() => {
                    if (this.active && this.isHost) { this._broadcastRoster(); this._broadcastState(); }
                }, 300);
            } else {
                this._setStatus(`已创建房间「${this.roomId}」。点“复制邀请链接”发给朋友即可加入。`, 'ok');
            }
        } else {
            this._setStatus(`正在加入房间「${this.roomId}」…`, 'ok');
        }

        this._applyNetworkMode(true);
        const show = (el, on) => { if (el) el.classList.toggle('hidden', !on); };
        if (this.el) {
            show(this.el.leave, true);
            show(this.el.copy, true);
            if (this.el.create) this.el.create.disabled = true;
            if (this.el.join) this.el.join.disabled = true;
            show(this.el.start, isHost);
        }
        this._syncSettingsUI();
        this._renderRoster();
        this._updateStartBtn();
        this._saveRecord();
        if (!this._resuming) this._sendHello();
        // 进入房间后，界面切到“联机”、关掉设置弹窗
        if (window.gameInterface && window.gameInterface._setSetupMode) {
            window.gameInterface._setSetupMode('online');
            if (window.gameInterface.closeSetup) window.gameInterface.closeSetup();
        }
    }

    async leave() {
        try { if (this.room) await this.room.leave(); } catch (e) { /* ignore */ }
        this.room = null;
        this.active = false;
        this.started = false;
        this.myColors = [];
        this.selfId = null;
        this.hostId = null;
        this.participants = [];
        this._roster = null;
        this._lastSeq = 0;
        this._clearFailoverTimer();
        this._applyNetworkMode(false);
        this._clearRecord();
        if (this.el) {
            if (this.el.leave) this.el.leave.classList.add('hidden');
            if (this.el.copy) this.el.copy.classList.add('hidden');
            if (this.el.create) this.el.create.disabled = false;
            if (this.el.join) this.el.join.disabled = false;
            if (this.el.start) this.el.start.classList.add('hidden');
        }
        this._syncSettingsUI();
        this._renderRoster();
        if (this._bound) this._setStatus('未联机', '');
    }

    // ================= 座位 / 开局 =================
    _minPlayers() { return this.settings.mode === Config.MODES.FFA ? 4 : 2; }

    _groupsFor(n) {
        if (this.settings.mode === Config.MODES.FFA) return [[0], [1], [2], [3]];
        if (n >= 4) return [[0], [1], [2], [3]];
        if (n === 3) return [[0], [1], [2, 3]];
        if (n === 2) return [[0, 1], [2, 3]];
        return [[0, 1, 2, 3]];
    }

    startMatch() {
        if (!this.active || !this.isHost || this.started) return;
        this._readSettingsFromUI();
        const n = this.participants.length;
        const min = this._minPlayers();
        if (n < min) { this._setStatus(`当前模式至少需要 ${min} 名玩家（当前 ${n} 人）`, 'error'); return; }

        const groups = this._groupsFor(n);
        this.participants.forEach((p, i) => { p.colors = groups[i] || []; });

        for (const p of this.participants) {
            if (p.token === this.token) this._setMyColors(p.colors);
            else if (p.id) this.actAssign.send({ colors: p.colors, hostId: this.selfId, settings: this.settings }, { target: p.id });
        }

        this.started = true;
        this.gameEngine.startNewGame();   // 房主权威开局（会应用 settings）
        this._broadcastRoster();
        this._broadcastState();           // 同步开局局面与规则给各端
        this.actNotice.send({ text: '对局开始！' });
        this._renderRoster();
        this._updateStartBtn();
        this._saveRecord();
    }

    _setMyColors(colors) {
        this.myColors = (colors || []).slice();
        this._applyNetworkMode(true);
        if (this.gameEngine) this.gameEngine.setControlledColors(this.myColors);
        const names = this.myColors.map(c => Config.PLAYER_COLORS[c].name).join('、');
        this._setStatus(this.myColors.length ? `你的角色：${names}` : '你以观战身份进入', 'ok');
        this._renderRoster();
    }

    _applyNetworkMode(on) {
        const ge = this.gameEngine;
        if (!ge) return;
        ge.isNetworkMode = !!on;
        if (ge.boardRenderer) {
            ge.boardRenderer.setNetworkMode(!!on);
            ge.boardRenderer.setPlayerPosition(this.myColors);
        }
        ge.setControlledColors(on ? this.myColors : null);
    }

    // ================= 成员 =================
    _findByToken(token) { return this.participants.find(p => p.token === token); }

    _onPeerJoin(peerId) {
        if (this.isHost) {
            // 等待对方 hello（带回 token 以便恢复席位）
            this._renderRoster();
            this._updateStartBtn();
        } else {
            this._sendHello();
        }
    }
    _onPeerLeave(peerId) {
        if (this.isHost) {
            const p = this.participants.find(p => p.id === peerId);
            if (p) p.id = null; // 断线，保留席位等待重连
            this._renderRoster();
            this._updateStartBtn();
        } else if (peerId === this.hostId) {
            this._setStatus('房主已离开，正在等待其重连…', 'error');
            this._startFailoverTimer();
        }
    }

    _startFailoverTimer() {
        if (this.isHost) return;
        this._clearFailoverTimer();
        this._failoverTimer = setTimeout(() => this._tryFailover(), ONLINE_FAILOVER_MS);
    }
    _clearFailoverTimer() {
        if (this._failoverTimer) { clearTimeout(this._failoverTimer); this._failoverTimer = null; }
    }
    _leaderAmong(ids) {
        const uniq = [...new Set((ids || []).filter(Boolean))].sort();
        return uniq[0] || null;
    }
    _tryFailover() {
        this._failoverTimer = null;
        if (!this.active || this.isHost || !this.room || !this.started) return;
        let ids = [];
        try { ids = Object.keys(this.room.getPeers ? (this.room.getPeers() || {}) : {}); } catch (e) { ids = []; }
        ids.push(this.selfId);
        if (this._leaderAmong(ids) !== this.selfId) return; // 让给别人接任
        this._becomeHost();
    }
    _becomeHost() {
        this.isHost = true;
        this.hostId = this.selfId;
        let me = this.participants.find(p => p.token === this.token);
        if (!me) {
            me = { token: this.token, id: this.selfId, colors: this.myColors.slice(), name: this.name };
            this.participants.push(me);
        } else {
            me.id = this.selfId;
            me.colors = this.myColors.slice();
        }
        this._broadcastRoster();
        this._broadcastState();
        this.actNotice.send({ text: '房主失联，已由我接任房主' });
        this._setStatus('房主失联，你已接任房主', 'ok');
        if (this.el && this.el.start) this.el.start.classList.add('hidden');
        this._saveRecord();
    }

    _sendHello() {
        if (this.isHost || !this.room) return;
        this.actHello.send({ name: this.name, token: this.token, colors: this.myColors, wantHost: false });
    }

    _onHello(d, peerId) {
        if (!this.isHost || !d) return;
        const token = d.token || peerId;
        let p = this._findByToken(token);
        if (!p) {
            p = { token, id: peerId, colors: (d.colors || []).slice(), name: d.name || '' };
            this.participants.push(p);
        } else {
            p.id = peerId;
            if (d.name) p.name = d.name;
        }
        // 回执：分配席位（若已开局）
        if (this.started) {
            this.actAssign.send({ colors: p.colors, hostId: this.selfId, settings: this.settings }, { target: peerId });
            this.actState.send(this._snapshot(), { target: peerId });
        }
        this._broadcastRoster();
        this._renderRoster();
        this._updateStartBtn();
        this._saveRecord();
    }

    _onAssign(d) {
        if (this.isHost || !d) return;
        if (d.hostId) this.hostId = d.hostId;
        if (d.settings) { this.settings = Object.assign({}, Config.DEFAULT_RULES, d.settings); this.gameEngine.gameState.setRules(this.settings); }
        this.started = true;
        this._setMyColors(d.colors || []);
    }

    _onRoster(d) {
        this._roster = d;
        if (d && d.hostId) {
            const changed = this.hostId && this.hostId !== d.hostId;
            this.hostId = d.hostId;
            this._clearFailoverTimer();
            if (!this.isHost && changed) this._sendHello(); // 新接任的房主需要认识我
        }
        if (d && d.settings) { this.settings = Object.assign({}, Config.DEFAULT_RULES, d.settings); this.gameEngine.gameState.setRules(this.settings); }
        if (!this.isHost) {
            if (d && d.started) this.started = true;
            this._renderRoster();
        }
    }

    _onNotice(d) { if (d && d.text) { Utils.showMessage(d.text, 'info'); this._setStatus(d.text, 'ok'); } }

    // ================= 走子 =================
    requestMove(fromX, fromY, toX, toY) {
        if (!this.active || !this.started) return;
        // 房主自己也必须走合法棋（防止通过界面/接口做非法操作）
        if (!this.gameEngine.ruleValidator.isValidMove(fromX, fromY, toX, toY)) {
            this._setStatus('非法走法，已阻止', 'error');
            return;
        }
        if (this.isHost) this._hostApplyAndBroadcast(fromX, fromY, toX, toY);
        else this.actIntent.send({ kind: 'move', from: [fromX, fromY], to: [toX, toY] });
    }

    _onIntent(d, peerId) {
        if (!this.isHost || !this.started || !d) return;
        const gs = this.gameEngine.gameState;
        if (d.kind === 'move') {
            const p = this.participants.find(p => p.id === peerId);
            const piece = gs.getPiece(d.from[0], d.from[1]);
            if (!piece || !p || !p.colors.includes(piece.player)) return this._reject(peerId, '只能移动自己的棋子');
            if (piece.player !== gs.currentPlayer) return this._reject(peerId, '还没轮到你');
            if (!this.gameEngine.ruleValidator.isValidMove(d.from[0], d.from[1], d.to[0], d.to[1])) return this._reject(peerId, '非法走法');
            this._hostApplyAndBroadcast(d.from[0], d.from[1], d.to[0], d.to[1]);
        } else if (d.kind === 'undo') {
            this._doUndo(true);
        } else if (d.kind === 'resign') {
            const p = this.participants.find(p => p.id === peerId);
            if (!p || !p.colors.includes(d.color)) return this._reject(peerId, '不能替别人认输');
            this._hostEliminate(d.color, 'resign');
        } else if (d.kind === 'resync') {
            this.actState.send(this._snapshot(), { target: peerId });
        }
    }

    _reject(peerId, text) { this.actNotice.send({ text }, { target: peerId }); }

    _hostApplyAndBroadcast(fromX, fromY, toX, toY) {
        const ge = this.gameEngine;
        const gs = ge.gameState;
        if (!gs.movePiece(fromX, fromY, toX, toY)) return;
        this.seq++;
        ge.boardRenderer.clearSelection();
        ge.boardRenderer.renderPieces();
        ge.onMoveCompleted();               // 将军/将死淘汰/结束/历史/存档/UI
        this.actMove.send({ seq: this.seq, from: [fromX, fromY], to: [toX, toY] });
        this._saveRecord();
    }

    _onMove(d) {
        if (this.isHost || !d) return;
        if (d.seq <= this._lastSeq) return;
        const ge = this.gameEngine, gs = ge.gameState;
        // 复核房主广播：非法则拒绝并请求重同步
        if (!ge.ruleValidator.isValidMove(d.from[0], d.from[1], d.to[0], d.to[1])) {
            Utils.showMessage('房主的操作非法，已拒绝', 'error');
            this.actIntent.send({ kind: 'resync' });
            return;
        }
        this._lastSeq = d.seq;
        gs.movePiece(d.from[0], d.from[1], d.to[0], d.to[1]);
        this._clientAfterApply();
    }

    _clientAfterApply() {
        const ge = this.gameEngine, gs = ge.gameState;
        ge.boardRenderer.clearSelection();
        ge.boardRenderer.renderPieces();
        ge.updateUI();
        if (ge.updateMoveHistory) ge.updateMoveHistory();
        if (ge.boardRenderer.highlightLastMove) ge.boardRenderer.highlightLastMove();
        if (ge.autoSave) ge.autoSave();
        if (gs.checkGameEnd()) ge.endGame();
    }

    requestUndo() {
        if (!this.active || !this.started) return;
        if (this.isHost) this._doUndo(true);
        else this.actIntent.send({ kind: 'undo' });
    }
    _doUndo(broadcast) {
        const ge = this.gameEngine, gs = ge.gameState;
        if (!gs.undoMove()) return;
        this.seq++;
        ge.boardRenderer.clearSelection();
        ge.boardRenderer.renderPieces();
        ge.updateUI();
        if (ge.updateMoveHistory) ge.updateMoveHistory();
        if (broadcast) this.actUndo.send({ seq: this.seq });
    }
    _onUndo(d) {
        if (this.isHost || !d) return;
        if (d.seq <= this._lastSeq) return;
        this._lastSeq = d.seq;
        const ge = this.gameEngine, gs = ge.gameState;
        gs.undoMove();
        ge.boardRenderer.clearSelection();
        ge.boardRenderer.renderPieces();
        ge.updateUI();
        if (ge.updateMoveHistory) ge.updateMoveHistory();
    }

    requestResign(color) {
        if (!this.active || !this.started) return;
        if (this.isHost) this._hostEliminate(color, 'resign');
        else this.actIntent.send({ kind: 'resign', color });
    }

    /**
     * 认输：只认输自己控制的颜色（优先当前回合的颜色）
     */
    requestResignSelf() {
        if (!this.active || !this.started) return;
        if (!this.myColors || !this.myColors.length) { this._setStatus('你没有可认输的颜色', 'error'); return; }
        const color = this.myColors.includes(this.gameState.currentPlayer)
            ? this.gameState.currentPlayer : this.myColors[0];
        this.requestResign(color);
    }

    _hostEliminate(player, reason) {
        const ge = this.gameEngine, gs = ge.gameState;
        if (gs.gamePhase !== 'playing') return;
        gs.eliminatePlayer(player);
        Utils.showMessage(`${Config.PLAYER_COLORS[player].name}${reason === 'resign' ? '认输' : '被将死'}`, 'warning');
        this.seq++;
        ge.boardRenderer.renderPieces();
        if (gs.checkGameEnd()) {
            ge.endGame();
        } else {
            gs.nextPlayer();
            ge.updateUI();
        }
        this.actEliminate.send({ player, reason, seq: this.seq });
        this._saveRecord();
    }
    /** 供 GameEngine.checkForCheck 调用（房主侧已本地淘汰，仅广播） */
    _broadcastEliminate(player, reason) {
        this.seq++;
        this.actEliminate.send({ player, reason, seq: this.seq });
        this._saveRecord();
    }
    _onEliminate(d) {
        if (this.isHost || !d) return;
        if (d.seq <= this._lastSeq) return;
        this._lastSeq = d.seq;
        const ge = this.gameEngine, gs = ge.gameState;
        gs.eliminatePlayer(d.player);
        ge.boardRenderer.renderPieces();
        if (gs.checkGameEnd()) {
            ge.endGame();
        } else {
            gs.nextPlayer();
            ge.updateUI();
        }
    }

    // ================= 快照（仅加入/重同步用） =================
    _snapshot() {
        const gs = this.gameEngine.gameState;
        return {
            seq: this.seq,
            currentPlayer: gs.currentPlayer,
            turn: gs.turn,
            gamePhase: gs.gamePhase,
            winner: gs.winner,
            ranking: gs.ranking,
            settings: this.settings,
            eliminationOrder: gs.eliminationOrder,
            eliminationLog: gs.eliminationLog,
            pieceCounts: gs.pieceCounts,
            moveHistory: gs.moveHistory,
            board: gs.board.map(col => col.map(p => p ? { t: p.type, p: p.player, f: p.facing || null } : null))
        };
    }
    _broadcastState() { this.seq++; this.actState.send(this._snapshot()); }

    _deserializeHistory(hist) {
        if (!Array.isArray(hist)) return [];
        return hist.map(mv => ({
            id: mv.id,
            player: mv.player,
            piece: mv.piece,
            from: { x: mv.from.x, y: mv.from.y },
            to: { x: mv.to.x, y: mv.to.y },
            captured: mv.captured
                ? new ChessPiece(mv.captured.type, mv.captured.player, mv.to.x, mv.to.y, mv.captured.facing || null)
                : null,
            turn: mv.turn,
            timestamp: mv.timestamp
        }));
    }

    _onState(d) {
        if (this.isHost || !d) return;
        if (d.seq < this._lastSeq) return;
        this._lastSeq = d.seq;
        if (d.settings) { this.settings = Object.assign({}, Config.DEFAULT_RULES, d.settings); }

        const ge = this.gameEngine, gs = ge.gameState;
        for (let x = 0; x < Config.BOARD_SIZE; x++) {
            for (let y = 0; y < Config.BOARD_SIZE; y++) {
                const c = d.board[x][y];
                gs.board[x][y] = c ? new ChessPiece(c.t, c.p, x, y, c.f || null) : null;
            }
        }
        gs.currentPlayer = d.currentPlayer;
        gs.turn = d.turn;
        gs.gamePhase = d.gamePhase;
        gs.winner = d.winner;
        gs.ranking = d.ranking || null;
        gs.eliminationOrder = d.eliminationOrder || [];
        gs.eliminationLog = d.eliminationLog || [];
        gs.pieceCounts = Object.assign({ 0: 0, 1: 0, 2: 0, 3: 0 }, d.pieceCounts);
        gs.moveHistory = this._deserializeHistory(d.moveHistory);
        gs.setRules(this.settings);
        gs.selectedPiece = null;
        gs.possibleMoves = [];

        ge.isGameActive = d.gamePhase === 'playing';
        ge.boardRenderer.clearSelection();
        ge.boardRenderer.renderPieces();
        ge.updateUI();
        if (ge.updateMoveHistory) ge.updateMoveHistory();
        if (d.gamePhase === 'finished') {
            ge.showGameResult ? ge.showGameResult() : null;
            this._setStatus('对局结束', 'ok');
        }
    }

    // ================= 结束 =================
    onGameEnd() {
        this._clearRecord();
        if (this.isHost) this._broadcastState();
    }

    // ================= 名册 / UI =================
    _broadcastRoster() {
        if (!this.isHost || !this.room) return;
        this.actRoster.send({
            hostId: this.selfId,
            count: this.participants.length,
            started: this.started,
            settings: this.settings,
            seats: this.participants.map(p => ({ name: p.name || '', colors: p.colors }))
        });
    }
    _renderRoster() {
        if (!this.el || !this.el.roster) return;
        const nameOf = (n, i) => Utils.escapeHtml(n ? n : `玩家${i + 1}`);
        if (this.isHost) {
            this.el.roster.innerHTML = this.participants.map((p, i) => {
                const role = p.colors.length ? p.colors.map(c => Config.PLAYER_COLORS[c].name).join('+') : '待分配';
                const online = p.token === this.token || p.id ? '' : '（离线）';
                return `<div>#${i + 1} ${nameOf(p.name, i)} ${p.token === this.token ? '(房主/你)' : online} — ${Utils.escapeHtml(role)}</div>`;
            }).join('');
        } else if (this._roster) {
            const d = this._roster;
            let html = `<div>房间内 ${d.count} 人</div>`;
            const seats = d.seats || [];
            html += seats.map((s, i) => {
                const role = (s.colors || []).length ? s.colors.map(c => Config.PLAYER_COLORS[c].name).join('+') : '待分配';
                return `<div>#${i + 1} ${nameOf(s.name, i)} — ${Utils.escapeHtml(role)}</div>`;
            }).join('');
            this.el.roster.innerHTML = html;
        } else {
            this.el.roster.innerHTML = '';
        }
    }
    _updateStartBtn() {
        if (!this.el || !this.el.start) return;
        const min = this._minPlayers();
        this.el.start.disabled = !(this.isHost && this.active && !this.started && this.participants.length >= min);
    }
    _setStatus(text, kind) {
        if (this.el && this.el.status) {
            this.el.status.textContent = text;
            this.el.status.className = 'online-status ' +
                (kind === 'error' ? 'online-status--error' : kind === 'ok' ? 'online-status--ok' : '');
        }
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = OnlineSession;
