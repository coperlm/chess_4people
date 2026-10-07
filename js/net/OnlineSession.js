// 联机对局（Trystero 免服务器 P2P，房主权威 + 各端复核）
// - 房主：持有权威 GameState/RuleValidator，校验并广播“走子”
// - 玩家：收到走子后，用同一套 RuleValidator 复核再落子；非法则拒绝并要求重同步
// - 房主刷新：凭本地 token/记录自动重连同房间并续局；房主失联超时则由在线玩家自动接任
const ONLINE_FAILOVER_MS = 20000;
const OFFLINE_SKIP_MS = 90000;   // 轮到“离线玩家”后，等这么久仍未重连才自动跳过其回合（手机切后台/锁屏很常见，太短会误跳）
const HOST_WAIT_MS = 12000;      // 非房主加入后，等这么久还没收到房主名册，就判定“找不到房主”并给出提示

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
        this._offlineTimer = null;   // 房主：轮到离线玩家时的“自动跳过”计时器
        this._hostWaitTimer = null;  // 非房主：加入后等待房主名册的计时器
        this._joinIssue = null;      // 加入阶段的问题：null | 'no-host' | 'connect-failed'
        this._drawYes = null;   // 求和：已同意的 token 集合
        this.mySeat = null;     // 我在名册中的座位号（非房主用，标注“你”）
        this._chatLog = [];     // 聊天记录（本端）
        this._chatUnread = 0;   // 未读聊天数
    }

    // ================= 初始化 =================
    init() {
        if (this._bound || typeof document === 'undefined') return;
        this._bound = true;
        const $ = id => document.getElementById(id);
        this.el = {
            name: $('playerNameInput'),
            mode: $('modeSelect'),
            victory: $('victorySelect'),
            ff: $('friendlyFireCheck'),
            create: $('createRoomBtn'),
            copy: $('copyInviteBtn'),
            join: $('joinRoomBtn'),
            joinInput: $('joinRoomInput'),
            status: $('onlineStatus'),
            roster: $('onlineRoster'),
            start: $('startOnlineBtn'),
            leave: $('leaveRoomBtn'),
            retry: $('onlineRetryBtn'),
            chatOpen: $('chatOpenBtn'),
            chatLog: $('chatLog'),
            chatInput: $('chatInput'),
            chatSend: $('chatSendBtn'),
            chatQuick: $('chatQuick'),
            chatEmoji: $('chatEmoji')
        };
        this._wireChat();
        if (this.el.mode) this.el.mode.addEventListener('change', () => { this._readSettingsFromUI(); this._syncSettingsUI(); this._updateStartBtn(); this._warnSettingsNextGame(); });
        if (this.el.victory) this.el.victory.addEventListener('change', () => { this._readSettingsFromUI(); this._broadcastRoster(); this._warnSettingsNextGame(); });
        if (this.el.ff) this.el.ff.addEventListener('change', () => { this._readSettingsFromUI(); this._broadcastRoster(); this._warnSettingsNextGame(); });
        if (this.el.name) this.el.name.addEventListener('change', () => {
            this.name = this.el.name.value.trim();
            if (this.active && !this.isHost) this._sendHello();
        });
        if (this.el.create) this.el.create.addEventListener('click', () => this._onCreate());
        if (this.el.copy) this.el.copy.addEventListener('click', () => this._copyInvite());
        if (this.el.join) this.el.join.addEventListener('click', () => this._onJoin());
        if (this.el.joinInput) this.el.joinInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this._onJoin(); }
        });
        // APK 里复制的是房间号而不是链接，按钮文案跟着变，免得名不副实
        if (this.el.copy && window.__CHESS4P_NATIVE__) this.el.copy.textContent = '复制房间号';
        if (this.el.start) this.el.start.addEventListener('click', () => this.startMatch());
        if (this.el.leave) this.el.leave.addEventListener('click', () => this.leave());
        if (this.el.retry) this.el.retry.addEventListener('click', () => this.retryConnect());
        this._syncSettingsUI();
    }

    _readSettingsFromUI() {        if (!this.el) return;
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
        const gs = this.gameEngine && this.gameEngine.gameState;
        const inGame = !!(this.active && this.started && gs && gs.gamePhase === 'playing');
        // 非房主始终锁定；对局进行中房主也锁定（避免中途改规则导致两端不一致）
        const locked = (this.active && !this.isHost) || inGame;
        if (this.el.mode) { this.el.mode.value = this.settings.mode; this.el.mode.disabled = locked; }
        if (this.el.victory) { this.el.victory.value = this.settings.victory; this.el.victory.disabled = locked || ffa; }
        if (this.el.ff) { this.el.ff.checked = !!this.settings.friendlyFire; this.el.ff.disabled = locked || ffa; }
    }
    _warnSettingsNextGame() {
        if (this.active && this.started) Utils.showMessage('设置更改将在下一局生效', 'info');
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
                name: this.name,
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
        const cs = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let s = '';
        for (let i = 0; i < 6; i++) s += cs[Math.floor(Math.random() * cs.length)];
        return s;
    }
    _validCode(c) { return /^[a-z0-9]{3,8}$/i.test(c || ''); }

    _inviteLink() { return `${location.origin}${location.pathname}?room=${this.roomId}`; }
    _copyInvite() {
        // 打包成 APK 后页面来自 WebView 本地，origin 是 https://localhost，这个链接别人点不开
        // → 改为复制房间号，让对方在游戏里「加入房间」输入（房间号就是链接里的 ?room=，跨端通用）
        const native = !!window.__CHESS4P_NATIVE__;
        const text = native ? this.roomId : this._inviteLink();
        const done = native
            ? `房间号已复制：${text}（朋友在游戏里点「加入房间」输入即可）`
            : `邀请链接已复制：${text}`;
        const manual = () => this._setStatus(native ? `请把房间号发给朋友：${text}` : '请手动复制邀请链接：' + text, 'ok');
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(() => this._setStatus(done, 'ok')).catch(manual);
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
            this._open(room.toLowerCase(), false);
            return true;
        } catch (e) { return false; }
    }

    _onCreate() {
        this._open(this._genCode(), true);
    }

    /**
     * 输入房间号加入（APK 内没有可点的邀请链接，只能靠房间号；网页端同样可用）
     */
    _onJoin() {
        if (!this.el || !this.el.joinInput) return;
        const code = (this.el.joinInput.value || '').trim().toLowerCase();
        if (!this._validCode(code)) {
            this._setStatus('房间号无效：应为 3–8 位字母或数字', 'error');
            return;
        }
        if (this.active && this.roomId === code) return;   // 已在同一房间，别把会话重开一遍
        this._open(code, false);
    }

    _open(roomId, isHost, record) {
        if (typeof Trystero === 'undefined' || !Trystero.joinRoom) {
            this._setStatus('联机组件未加载（vendor/trystero.nostr.iife.js）', 'error');
            return;
        }
        // 同步拆除旧会话（并异步关闭旧 room），避免旧 leave() 的收尾冲掉新会话
        const oldRoom = this._teardown();
        if (oldRoom) { try { Promise.resolve(oldRoom.leave()).catch(() => {}); } catch (e) { /* ignore */ } }

        this.roomId = roomId;
        this.isHost = isHost;
        this.active = true;
        // 序号用于各端严格排序；房主用一个“时间戳基数”，保证大于任何旧客户端已见过的序号
        // （否则房主刷新/failover 后 seq 从 0 重来，还在线的旧端会因 d.seq<=_lastSeq 丢弃后续广播 → 失步）
        this.seq = isHost ? Date.now() : 0;
        this._lastSeq = 0;
        this.myColors = [];
        this.mySeat = null;
        this.participants = [];
        this.token = this.token || this._loadToken();
        this.name = (this.el && this.el.name && this.el.name.value.trim())
            || (this._resuming && record && record.name)   // 重连续用原昵称（否则每次刷新都变随机串）
            || this.name || this._randomId();
        if (!this._resuming) { this.started = false; if (isHost) this._readSettingsFromUI(); }

        try {
            // 多连几条公共 nostr 中继做冗余（内置列表 29 条，默认只用 5 条）
            const cfg = { appId: this.appId, password: this.roomId };
            if (Config.RELAY_REDUNDANCY) cfg.relayConfig = { redundancy: Config.RELAY_REDUNDANCY };
            // ICE：显式给出 STUN（+ 可选 TURN），否则跨网络（CGNAT/对称 NAT）只能靠内置 Google STUN、常打不通
            const ice = (Config.iceServers && Config.iceServers()) || null;
            if (ice && ice.length) cfg.rtcConfig = { iceServers: ice };
            // 第三个参数是回调对象：建连失败（SDP 交换后仍连不上）时会回调，用于给出明确提示
            this.room = Trystero.joinRoom(cfg, this.roomId, {
                onJoinError: (info) => this._onJoinError(info)
            });
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
        this.actDraw = this.room.makeAction('draw');
        this.actKick = this.room.makeAction('kick');
        this.actChat = this.room.makeAction('chat');

        this.actHello.onMessage = (d, ctx) => this._onHello(d, ctx.peerId);
        this.actAssign.onMessage = d => this._onAssign(d);
        this.actRoster.onMessage = d => this._onRoster(d);
        this.actState.onMessage = d => this._onState(d);
        this.actNotice.onMessage = d => this._onNotice(d);
        this.actIntent.onMessage = (d, ctx) => this._onIntent(d, ctx.peerId);
        this.actMove.onMessage = d => this._onMove(d);
        this.actUndo.onMessage = d => this._onUndo(d);
        this.actEliminate.onMessage = d => this._onEliminate(d);
        this.actDraw.onMessage = d => this._onDraw(d);
        this.actKick.onMessage = d => this._onKick(d);
        this.actChat.onMessage = d => this._onChat(d);

        this.room.onPeerJoin = id => this._onPeerJoin(id);
        this.room.onPeerLeave = id => this._onPeerLeave(id);

        if (isHost) {
            this.hostId = this.selfId;
            const roster = (record && record.roster) || [];
            // record.roster 里也含房主一条：重连时要把房主自己的颜色恢复回来，否则会变成“观战”
            const savedSelf = roster.find(r => r.token === this.token);
            this.participants = [{ token: this.token, id: this.selfId, colors: (savedSelf && savedSelf.colors) || [], name: this.name }];
            const seen = new Set([this.token]);
            for (const r of roster) {
                if (!r.token || seen.has(r.token)) continue;   // 跳过自己 + 去重
                seen.add(r.token);
                this.participants.push({ token: r.token, id: null, colors: r.colors || [], name: r.name || '' });
            }
            // 重连且已开局：把房主颜色应用上（否则只能观战）
            if (this._resuming && this.participants[0].colors.length) this.myColors = this.participants[0].colors.slice();
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
            // 已在房间内：隐藏“创建房间”，房主/非房主都一样，避免留下一个灰按钮
            if (this.el.create) { this.el.create.disabled = true; this.el.create.classList.add('hidden'); }
            if (this.el.join) { this.el.join.disabled = true; this.el.join.classList.add('hidden'); }
            show(this.el.joinInput, false);
            show(this.el.start, isHost);
            show(this.el.retry, !isHost);   // 非房主：给一个“重试连接”入口（找不到房主时用）
        }
        this._syncSettingsUI();
        this._renderRoster();
        this._updateStartBtn();
        this._refreshStatus();     // 房间号 + 规则 + 角色（房主与非房主都显示）
        this._saveRecord();
        if (!this._resuming) this._sendHello();
        if (!isHost) this._startHostWait();   // 非房主：起“等待房主”看门狗，超时未收到名册就提示找不到房主
        // 进入房间后：确保在“对局设置”弹窗的联机页
        if (window.gameInterface) {
            window.gameInterface.configured = true;
            if (window.gameInterface._setSetupMode) window.gameInterface._setSetupMode('online');
            if (window.gameInterface.openSetup) window.gameInterface.openSetup();
            if (window.gameInterface.updateOnlinePanel) window.gameInterface.updateOnlinePanel();
        }
    }

    /**
     * 同步清空本端会话状态，并返回原 room（供异步关闭）。
     * 关键：必须“同步”清空——否则在已处于房间时再次 _open，leave() 里未 await 的收尾会
     * 在 _open 建好新会话之后才执行，把新会话冲掉。
     */
    _teardown() {
        const room = this.room;
        this.room = null;
        this.active = false;
        this.started = false;
        this.myColors = [];
        this.mySeat = null;
        this.selfId = null;
        this.hostId = null;
        this.participants = [];
        this._roster = null;
        this._lastSeq = 0;
        this._drawYes = null;
        this._clearFailoverTimer();
        this._clearOfflineTimer();
        this._clearHostWait();
        this._joinIssue = null;
        try { if (this.gameEngine && this.gameEngine.boardRenderer && this.gameEngine.boardRenderer.cancelPremove) this.gameEngine.boardRenderer.cancelPremove(); } catch (e) { /* ignore */ }
        this._applyNetworkMode(false);
        return room;
    }

    async leave() {
        const room = this._teardown();
        try { if (room) await room.leave(); } catch (e) { /* ignore */ }
        this._clearRecord();
        if (this.el) {
            if (this.el.leave) this.el.leave.classList.add('hidden');
            if (this.el.copy) this.el.copy.classList.add('hidden');
            if (this.el.create) { this.el.create.disabled = false; this.el.create.classList.remove('hidden'); }
            if (this.el.join) { this.el.join.disabled = false; this.el.join.classList.remove('hidden'); }
            if (this.el.joinInput) this.el.joinInput.classList.remove('hidden');
            if (this.el.start) this.el.start.classList.add('hidden');
            if (this.el.retry) this.el.retry.classList.add('hidden');
        }
        this._syncSettingsUI();
        this._renderRoster();
        if (window.gameInterface && window.gameInterface.updateOnlinePanel) window.gameInterface.updateOnlinePanel();
        if (this._bound) this._setStatus('未联机', '');
    }

    // ================= 座位 / 开局 =================
    _minPlayers() { return this.settings.mode === Config.MODES.FFA ? 3 : 2; }   // 混战 3~4 人；组队 2~4 人

    _groupsFor(n) {
        if (this.settings.mode === Config.MODES.FFA) return [[0], [1], [2], [3]];
        if (n >= 4) return [[0], [1], [2], [3]];
        if (n === 3) return [[0], [1], [2]];   // 3 人组队：各控一色，第 4 色（黑）整色移除
        if (n === 2) return [[0, 1], [2, 3]];
        return [[0, 1, 2, 3]];
    }

    startMatch() {
        if (!this.active || !this.isHost) return;
        if (this.started && this.gameEngine.gameState.gamePhase !== 'finished') return;
        this._readSettingsFromUI();
        const n = this.participants.length;
        const min = this._minPlayers();
        if (n < min) { this._setStatus(`当前模式至少需要 ${min} 名玩家（当前 ${n} 人）`, 'error'); return; }

        const groups = this._groupsFor(n);
        this.participants.forEach((p, i) => { p.colors = groups[i] || []; });

        this.participants.forEach((p, i) => {
            if (p.token === this.token) this._setMyColors(p.colors);
            else if (p.id) this.actAssign.send({ colors: p.colors, seat: i, hostId: this.selfId, settings: this.settings }, { target: p.id });
        });

        this.started = true;
        this.gameEngine.startNewGame();   // 房主权威开局（会应用 settings）

        // 未被任何玩家分配到的颜色（如 3 人组队时的第 4 色）：整色移除，但**不算出局**
        const assigned = new Set();
        this.participants.forEach(p => (p.colors || []).forEach(c => assigned.add(c)));
        let removedAny = false;
        for (let c = 0; c < 4; c++) if (!assigned.has(c)) { this.gameEngine.gameState.removeColor(c); removedAny = true; }
        if (removedAny) {                    // 棋盘与棋子计数都要重绘，否则界面仍显示被移除的一方
            this.gameEngine.boardRenderer.renderPieces();
            this.gameEngine.updateUI();
        }

        this._broadcastRoster();
        this._broadcastState();           // 同步开局局面与规则给各端
        this.actNotice.send({ text: '对局开始！' });
        this._renderRoster();
        this._updateStartBtn();
        this._saveRecord();
        // 开局：所有人自动关闭设置弹窗，回主页面看棋盘与房间状态
        if (window.gameInterface) {
            if (window.gameInterface.updateOnlinePanel) window.gameInterface.updateOnlinePanel();
            if (window.gameInterface.closeSetup) window.gameInterface.closeSetup();
        }
        this._refreshStatus();
        this._checkOfflineTurn();   // 开局先手若离线则开始计时
    }

    _setMyColors(colors) {
        this.myColors = (colors || []).slice();
        this._applyNetworkMode(true);
        if (this.gameEngine) this.gameEngine.setControlledColors(this.myColors);
        this._renderRoster();
        this._refreshStatus();
    }

    /** 房间规则摘要（房主/非房主都能看到当前配置） */
    _rulesSummary() {
        const s = this.settings || Config.DEFAULT_RULES;
        const mode = s.mode === Config.MODES.FFA ? '混战' : '两两组队';
        const vic = s.mode === Config.MODES.FFA ? '仅剩一人' : (s.victory === Config.VICTORY.LAST_TEAM ? '仅剩一队' : '吃将即结束');
        return `${mode}·${vic}${s.friendlyFire ? '·友伤开' : ''}`;
    }

    /** 统一刷新“联机状态”行：房间号 + 规则 + 我的角色 + 轮到谁（房主与非房主都显示） */
    _refreshStatus() {
        if (!this.active) return;
        // 加入阶段出过问题（找不到房主 / 连不上）：状态行持续显示该错误，别被常规刷新覆盖
        const issue = this._joinIssueText();
        if (issue && !this.started) { this._setStatus(issue, 'error'); return; }
        const gs = this.gameEngine && this.gameEngine.gameState;
        const role = !this.started ? '待分配'
            : (this.myColors.length ? this.myColors.map(c => Config.PLAYER_COLORS[c].name).join('、') : '观战');
        let turn = this.started ? ''
            : (this.active && !this.isHost && !this._roster ? '正在寻找房主…' : '等待房主开始');
        if (this.started && gs) {
            if (gs.gamePhase === 'finished') turn = this.isHost ? '对局结束 · 可点「新游戏/房间状态」重开' : '对局结束 · 等待房主重开';
            else {
                const cp = gs.currentPlayer;
                turn = `轮到 ${Config.PLAYER_COLORS[cp].name}${this.myColors.includes(cp) ? '（你）' : ''}`;
            }
        }
        const head = `房间 ${Utils.escapeHtml(this.roomId)} · ${Utils.escapeHtml(this._rulesSummary())} · ${Utils.escapeHtml(this._countState())}`;
        this._setStatus(`${head}\n你的角色：${Utils.escapeHtml(role)}${turn ? ' · ' + Utils.escapeHtml(turn) : ''}`, 'ok');
    }

    /** 走子提醒：自己的子用 success，别人的子用 info（提醒对手已走） */
    _notifyMove(mover, fromX, fromY, toX, toY, pieceType, captured) {
        const name = Config.PLAYER_COLORS[mover].name;
        const pname = (Config.PIECE_NAMES[mover] && Config.PIECE_NAMES[mover][pieceType]) || '';
        const mine = this.myColors.includes(mover);
        Utils.showMessage(`${name} ${pname} ${Notation.span({ x: fromX, y: fromY }, { x: toX, y: toY })}`, mine ? 'success' : 'info');
        if (window.sound) window.sound.play(captured ? 'capture' : 'move');
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
        // 进/出联机都会改变“本步倒计时”的启停条件（它只在联机时跑）。
        // 这里立刻重估一次，否则退出房间后那个 60s 定时器会继续跑到归零。
        try { if (ge.updateTurnTimer) ge.updateTurnTimer(); } catch (e) { /* 计时失败不影响对局 */ }
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
            this._broadcastRoster();    // 让所有玩家都能互相看到“（离线）”
            this._checkOfflineTurn();   // 若正好轮到该玩家，超时后自动跳过其回合
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

    // ================= 加入阶段：等待房主 / 连接失败反馈 =================
    /**
     * 非房主加入后起一个看门狗：若 HOST_WAIT_MS 内始终没收到房主的任何权威消息，
     * 说明“房间号对应的房主不在 / 网络打不通”，给出明确提示——而不是让界面一直显示“0 人”。
     */
    _startHostWait() {
        this._clearHostWait();
        const t = setTimeout(() => { this._hostWaitTimer = null; this._onHostWaitTimeout(); }, HOST_WAIT_MS);
        if (t && typeof t.unref === 'function') t.unref();   // Node（测试）中不因它拖住进程
        this._hostWaitTimer = t;
    }
    _clearHostWait() {
        if (this._hostWaitTimer) { clearTimeout(this._hostWaitTimer); this._hostWaitTimer = null; }
    }
    /** 收到房主的任何权威消息（名册/席位/快照）即视为“已找到房主” */
    _hostFound() {
        const hadIssue = !!this._joinIssue;
        this._clearHostWait();
        this._joinIssue = null;
        // 之前若报过“找不到房主/连不上”，连上后要把那条红色状态刷掉，别让它一直挂着
        if (hadIssue) this._refreshStatus();
    }
    /** 加入阶段问题的统一文案（null = 没问题） */
    _joinIssueText() {
        if (this._joinIssue === 'no-host') {
            return `找不到房主（房间号 ${this.roomId}）。请确认房主已创建房间并保持在线；若房间号无误，`
                + `可能是双方网络无法直连——建议双方连接同一 Wi-Fi 后再点「重试连接」。`;
        }
        if (this._joinIssue === 'connect-failed') {
            const hasTurn = Config.hasTurnServer && Config.hasTurnServer();
            const tail = hasTurn
                ? '已启用中继仍失败，可能是当前网络限制了 P2P / 中继连接'
                : '当前未配置 TURN 中继，对称 NAT / 运营商网络下可能无法直连';
            return `无法连接到房主：${tail}。建议双方连接同一 Wi-Fi，或点「重试连接」。`;
        }
        return null;
    }
    _onHostWaitTimeout() {
        if (!this.active || this.isHost || this._roster || this.started) return;   // 已连上房主则忽略
        if (this._joinIssue === 'connect-failed') return;   // 已有更具体的建连失败提示，不覆盖
        this._joinIssue = 'no-host';
        this._setStatus(this._joinIssueText(), 'error');
        Utils.showMessage('找不到房主：请检查房间号与网络', 'warning');
        this._renderRoster();   // 刷新大厅提示
    }
    /** Trystero 建连失败回调：SDP 交换后仍无法建立 P2P 通道（多为 NAT / 防火墙受限） */
    _onJoinError(info) {
        if (!this.active || this.isHost) return;    // 房主侧不需要这类提示
        if (this._roster || this.started) return;   // 已连上房主，忽略迟到的错误
        if (info && info.error) console.warn('[online] join error:', info.error, info.peerId || '');
        this._joinIssue = 'connect-failed';
        this._setStatus(this._joinIssueText(), 'error');
        Utils.showMessage('无法连接到房主（网络受限）', 'warning');
        this._renderRoster();
    }
    /** 非房主：重试连接（以同一房间号重新加入） */
    retryConnect() {
        if (!this.active || this.isHost || !this.roomId) return;
        this._joinIssue = null;
        this._setStatus(`正在重试连接房主…（房间号 ${this.roomId}）`, 'ok');
        this._open(this.roomId, false);
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
        this.seq = Date.now();   // 接任后用时间戳基数，避免与上任房主的序号冲突
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
        this._checkOfflineTurn();   // 接任后可能正好轮到某位离线玩家
    }

    /**
     * 房主：轮到“离线玩家”时为其回合计时，超时未重连则自动跳过（只推进回合，不动棋盘）。
     * 与“困毙”互不影响——困毙只看棋盘有无合法走法，由 resolveAfterMove 每步对全部存活玩家计算。
     */
    _checkOfflineTurn() {
        if (!this.isHost || !this.active || !this.started) return this._clearOfflineTimer();
        const ge = this.gameEngine, gs = ge && ge.gameState;
        if (!gs || gs.gamePhase !== 'playing') return this._clearOfflineTimer();
        const cur = gs.currentPlayer;
        const p = this.participants.find(x => (x.colors || []).includes(cur));
        if (p && p.id == null) {
            if (this._offlineTimer) return;   // 已在倒计时，勿重复排定时器
            this._offlineTimer = setTimeout(() => this._skipOfflineTurn(), OFFLINE_SKIP_MS);
            this.actNotice.send({ text: `${Config.PLAYER_COLORS[cur].name}（离线）将在 ${Math.round(OFFLINE_SKIP_MS / 1000)}s 后被跳过` });
        } else {
            this._clearOfflineTimer();        // 当前玩家在线（或已重连）：撤销计时
        }
    }
    _clearOfflineTimer() {
        if (this._offlineTimer) { clearTimeout(this._offlineTimer); this._offlineTimer = null; }
    }
    _skipOfflineTurn() {
        this._clearOfflineTimer();
        if (!this.isHost || !this.active || !this.started) return;
        const ge = this.gameEngine, gs = ge && ge.gameState;
        if (!gs || gs.gamePhase !== 'playing') return;
        const cur = gs.currentPlayer;
        const p = this.participants.find(x => (x.colors || []).includes(cur));
        if (!p || p.id != null) return this._checkOfflineTurn();   // 已重连：不跳过
        const name = Config.PLAYER_COLORS[cur].name;
        gs.nextPlayer();                       // 只推进回合，不淘汰、不清子
        ge.boardRenderer.clearSelection();
        ge.boardRenderer.renderPieces();
        ge.updateUI();
        if (ge.updateMoveHistory) ge.updateMoveHistory();
        this.actNotice.send({ text: `${name}（离线）回合已跳过` });
        this._broadcastState();                // 同步新的当前回合给各端
        this._checkOfflineTurn();              // 若接下来仍是离线玩家，继续为其计时
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
            this.actAssign.send({ colors: p.colors, seat: this.participants.indexOf(p), hostId: this.selfId, settings: this.settings }, { target: peerId });
            this.actState.send(this._snapshot(), { target: peerId });
        }
        this._broadcastRoster();
        this._renderRoster();
        this._updateStartBtn();
        this._saveRecord();
        this._checkOfflineTurn();   // 该玩家重连后，若正轮到他就撤销“自动跳过”计时
    }

    _onAssign(d) {
        if (this.isHost || !d) return;
        this._hostFound();
        if (d.hostId) this.hostId = d.hostId;
        // 只记录设置；真正应用以房主广播的局面快照为准（避免局中改设置导致两端规则不一致）
        if (d.settings) this.settings = Object.assign({}, Config.DEFAULT_RULES, d.settings);
        if (typeof d.seat === 'number') this.mySeat = d.seat;
        this.started = true;
        // 开局即记录开始时间（房主也由此兜底；快照里的 startedAt 会随后覆盖为权威值）
        if (this.gameEngine && !this.gameEngine.gameStartTime) this.gameEngine.gameStartTime = Date.now();
        this._setMyColors(d.colors || []);
        // 开局：自动关闭设置弹窗，回主页面
        if (window.gameInterface) {
            if (window.gameInterface.updateOnlinePanel) window.gameInterface.updateOnlinePanel();
            if (window.gameInterface.closeSetup) window.gameInterface.closeSetup();
        }
    }

    _onRoster(d) {
        this._roster = d;
        if (d) this._hostFound();   // 名册只有房主会广播：收到即“已找到房主”
        if (d && d.hostId) {
            const changed = this.hostId && this.hostId !== d.hostId;
            this.hostId = d.hostId;
            this._clearFailoverTimer();
            if (!this.isHost && changed) this._sendHello(); // 新接任的房主需要认识我
        }
        if (d && d.settings) this.settings = Object.assign({}, Config.DEFAULT_RULES, d.settings);
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
            const p = this.participants.find(p => p.id === peerId);
            if (!p || !(p.colors || []).length) return this._reject(peerId, '观战者不能悔棋');
            if ((p.colors || []).every(c => gs.eliminationOrder.includes(c))) return this._reject(peerId, '已出局者不能悔棋');
            this._doUndo(true, p.name || '玩家');
        } else if (d.kind === 'resign') {
            const p = this.participants.find(p => p.id === peerId);
            const colors = d.colors || (d.color !== undefined ? [d.color] : []);
            if (!p || !colors.length || !colors.every(c => p.colors.includes(c))) return this._reject(peerId, '不能替别人认输');
            this._hostResignColors(colors);
        } else if (d.kind === 'resync') {
            this.actState.send(this._snapshot(), { target: peerId });
        }
    }

    _reject(peerId, text) { this.actNotice.send({ text }, { target: peerId }); }

    _hostApplyAndBroadcast(fromX, fromY, toX, toY) {
        const ge = this.gameEngine;
        const gs = ge.gameState;
        const piece = gs.getPiece(fromX, fromY);
        const mover = piece ? piece.player : gs.currentPlayer;
        const ptype = piece ? piece.type : 'pawn';
        const captured = !!gs.getPiece(toX, toY);
        if (!gs.movePiece(fromX, fromY, toX, toY)) return;
        this._drawYes = null;   // 有新走子，作废未完成的求和

        // 先广播走子（较小 seq），再做结算：若本手吃将/令对手困毙，
        // 结算会广播淘汰（seq 更大）——保证客户端严格按 seq 顺序“先落子、后淘汰”。
        // 若顺序反了，走子会因 d.seq <= lastSeq 被客户端丢弃而导致失步。
        this.seq++;
        this.actMove.send({ seq: this.seq, from: [fromX, fromY], to: [toX, toY], by: mover });

        ge.boardRenderer.clearSelection();
        ge.boardRenderer.renderPieces({ fromX, fromY, toX, toY });
        ge.onMoveCompleted();               // 结算：吃将/困毙淘汰、结束、历史、存档、UI（可能再 ++seq 广播 eliminate）
        this._notifyMove(mover, fromX, fromY, toX, toY, ptype, captured);
        this._refreshStatus();
        this._saveRecord();
        this._checkOfflineTurn();           // 回合轮到下家：若其离线则开始计时
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
        const piece = gs.getPiece(d.from[0], d.from[1]);
        const mover = (d.by !== undefined) ? d.by : (piece ? piece.player : gs.currentPlayer);
        const ptype = piece ? piece.type : 'pawn';
        const captured = !!gs.getPiece(d.to[0], d.to[1]);
        gs.movePiece(d.from[0], d.from[1], d.to[0], d.to[1]);
        this._drawYes = null;   // 有新走子，作废未完成的求和
        this._clientAfterApply({ fromX: d.from[0], fromY: d.from[1], toX: d.to[0], toY: d.to[1] });
        this._notifyMove(mover, d.from[0], d.from[1], d.to[0], d.to[1], ptype, captured);
        this._refreshStatus();
    }

    _clientAfterApply(move) {
        const ge = this.gameEngine, gs = ge.gameState;
        ge.boardRenderer.clearSelection();
        ge.boardRenderer.renderPieces(move);
        ge.updateUI();
        if (ge.updateMoveHistory) ge.updateMoveHistory();
        if (ge.boardRenderer.highlightLastMove) ge.boardRenderer.highlightLastMove();
        if (ge.autoSave) ge.autoSave();
        // 与房主用同一套结算：淘汰被吃/困毙 + 必要时推进 currentPlayer + 结束。
        // 若只调 checkGameEnd，会出现“轮到被吃方”时房主已 nextPlayer、客户端没推进 → 回合/当前方漂移。
        if (ge.resolveAfterMove) ge.resolveAfterMove();
        else if (gs.checkGameEnd()) ge.endGame();
    }

    /** 自己控制的颜色是否已全部出局（将/帅被吃或困毙）——已出局者不应再影响对局 */
    _allEliminated() {
        const gs = this.gameEngine && this.gameEngine.gameState;
        const mine = this.myColors || [];
        return !!(gs && mine.length && mine.every(c => gs.eliminationOrder.includes(c)));
    }

    requestUndo() {
        if (!this.active || !this.started) return;
        if (!this.myColors || !this.myColors.length) { this._setStatus('观战者不能悔棋', 'error'); return; }
        if (this._allEliminated()) { this._setStatus('你已出局，不能悔棋', 'error'); return; }
        if (this.isHost) this._doUndo(true, this.name || '房主');
        else this.actIntent.send({ kind: 'undo' });
    }
    _doUndo(broadcast, who) {
        const ge = this.gameEngine, gs = ge.gameState;
        if (!gs.undoMove()) return;
        // 悔棋→局面又变了：之前对“求和”的同意作废，需要重新确认（与“走新子会作废求和”同理）
        const hadDraw = !!this._drawYes;
        this._drawYes = null;
        if (window.sound) window.sound.play('undo');
        this.seq++;
        ge.boardRenderer.clearSelection();
        if (ge.boardRenderer.cancelPremove) ge.boardRenderer.cancelPremove();
        ge.boardRenderer.renderPieces();
        ge.updateUI();
        if (ge.updateMoveHistory) ge.updateMoveHistory();
        if (broadcast) {
            this.actUndo.send({ seq: this.seq });
            if (who) this.actNotice.send({ text: `${who} 悔棋` });
            if (hadDraw) this.actNotice.send({ text: '求和需重新确认' });
        }
        this._checkOfflineTurn();   // 悔棋后当前回合可能落到某位离线玩家
    }
    _onUndo(d) {
        if (this.isHost || !d) return;
        if (d.seq <= this._lastSeq) return;
        this._lastSeq = d.seq;
        this._drawYes = null;   // 悔棋→局面变了：本地挂着的求和同意作废
        const ge = this.gameEngine, gs = ge.gameState;
        gs.undoMove();
        if (window.sound) window.sound.play('undo');
        ge.boardRenderer.clearSelection();
        ge.boardRenderer.renderPieces();
        ge.updateUI();
        if (ge.updateMoveHistory) ge.updateMoveHistory();
    }

    requestResign(colors) {
        if (!this.active || !this.started) return;
        const list = Array.isArray(colors) ? colors : [colors];
        if (this.isHost) this._hostResignColors(list);
        else this.actIntent.send({ kind: 'resign', colors: list });
    }

    /**
     * 认输：认输自己控制的**全部**颜色（2 人组队时一人控两色，认输应整队认输）
     */
    requestResignSelf() {
        if (!this.active || !this.started) return;
        if (!this.myColors || !this.myColors.length) { this._setStatus('你没有可认输的颜色', 'error'); return; }
        if (this._allEliminated()) { this._setStatus('你已出局', 'error'); return; }
        this.requestResign(this.myColors.slice());
    }

    /**
     * 房主：淘汰一整组颜色（认输）。先全部淘汰再判终局，避免“淘汰第一个颜色就结束、
     * 第二个颜色没被处理”的问题。
     */
    _hostResignColors(colors) {
        const ge = this.gameEngine, gs = ge.gameState;
        if (gs.gamePhase !== 'playing') return;
        const removed = [];
        for (const c of colors) {
            if (!gs.hasKing(c)) continue;          // 已出局，跳过
            gs.eliminatePlayer(c);
            Utils.showMessage(`${Config.PLAYER_COLORS[c].name}认输`, 'warning');
            removed.push(c);
        }
        if (gs.checkGameEnd()) {
            ge.endGame();
        } else {
            if (!gs.hasKing(gs.currentPlayer)) gs.nextPlayer();
            ge.boardRenderer.renderPieces();
            ge.updateUI();
        }
        // 始终广播一次（即便本次没有新淘汰，也把房主权威的“当前方/回合”带给客户端；
        // 否则房主因 nextPlayer 推进而客户端不推进 → 漂移）
        this._broadcastEliminateMany(removed, 'resign');
        this._saveRecord();
    }

    /** 房主：广播一组被淘汰颜色 + 权威的当前方/回合（用于认输 / 踢人这类非走子路径） */
    _broadcastEliminateMany(players, reason) {
        this.seq++;
        const gs = this.gameEngine.gameState;
        this.actEliminate.send({ players: players || [], reason, seq: this.seq, cp: gs.currentPlayer, turn: gs.turn });
        this._saveRecord();
    }

    /** 供 GameEngine 结算时调用（房主侧已本地淘汰，仅广播） */
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
        const players = d.players || (d.player !== undefined ? [d.player] : []);
        for (const p of players) gs.eliminatePlayer(p);
        ge.boardRenderer.renderPieces();
        if (gs.checkGameEnd()) {
            ge.endGame();
            ge.updateUI();
        } else if (d.cp !== undefined && d.turn !== undefined) {
            // 房主权威撤销/淘汰路径：直接采用房主的“当前方/回合”，避免各端各自推导导致漂移
            gs.currentPlayer = d.cp;
            gs.turn = d.turn;
            ge.updateUI();
        } else {
            // 走子结算路径：客户端已跑过 resolveAfterMove，这里只兜底
            if (!gs.hasKing(gs.currentPlayer)) gs.nextPlayer();
            ge.updateUI();
        }
    }

    // ================= 求和 =================
    /**
     * 发起求和：全体存活参与者同意则和棋（房主负责汇总判定）
     */
    requestDraw() {
        if (!this.active || !this.started) return;
        if (!this.myColors || !this.myColors.length) { this._setStatus('观战者不能求和', 'error'); return; }
        if (this._allEliminated()) { this._setStatus('你已出局，不能求和', 'error'); return; }
        if (this.gameEngine.gameState.gamePhase !== 'playing') return;
        this._drawYes = new Set([this.token]);
        this.actDraw.send({ kind: 'offer', token: this.token, name: this.name || '玩家' });
        Utils.showMessage('已发起求和，等待其他玩家同意…', 'info');
    }
    /**
     * 非阻塞的“是否同意和棋”询问。
     * 不能用 confirm()：标签页在后台时浏览器会直接把它当成“取消”并立即返回 false，
     * 导致对方根本没看到弹窗、发起方却收到“被拒绝”。这里改用页面内的按钮。
     */
    _promptDraw(name) {
        const d = document.getElementById('drawPrompt');
        const txt = document.getElementById('drawPromptText');
        const ok = document.getElementById('drawAcceptBtn');
        const no = document.getElementById('drawRejectBtn');
        if (!d || !txt || !ok || !no) return Promise.resolve(confirm(`『${name}』提议和棋，是否同意？`));  // 无 DOM（如测试）时退化
        if (this._drawPromptOpen) return Promise.resolve('busy');   // 上一条询问还没答复：忽略本次（不要误发“被拒绝”）
        this._drawPromptOpen = true;
        txt.textContent = `『${name}』提议和棋，是否同意？`;
        d.classList.remove('hidden');
        return new Promise(resolve => {
            const done = val => {
                d.classList.add('hidden');
                ok.removeEventListener('click', onOk);
                no.removeEventListener('click', onNo);
                this._drawPromptOpen = false;
                resolve(val);
            };
            const onOk = () => done(true);
            const onNo = () => done(false);
            ok.addEventListener('click', onOk);
            no.addEventListener('click', onNo);
        });
    }

    async _onDraw(d) {
        if (!d) return;
        if (d.kind === 'offer') {
            if (d.token === this.token) return;                 // 自己发起的，不弹
            if (!this.myColors || !this.myColors.length) return; // 观战者不参与求和（不弹窗、不否决）
            if (this._allEliminated()) return;                   // 已出局者不参与求和（不弹窗、不记票）
            if (this.isHost) { this._drawYes = this._drawYes || new Set(); this._drawYes.add(d.token); }  // 提议者视为已同意
            const agreed = await this._promptDraw(d.name || '对方');
            if (agreed === 'busy') return;              // 上一条还没答复：忽略，不误判为拒绝
            if (agreed) {
                if (this.isHost) { this._drawYes.add(this.token); this._tryResolveDraw(); }
                else this.actDraw.send({ kind: 'accept', token: this.token }, { target: this.hostId });
            } else {
                if (this.isHost) this._rejectDraw(this.name || '房主');
                else this.actDraw.send({ kind: 'reject', token: this.token, name: this.name || '玩家' }, { target: this.hostId });
            }
        } else if (d.kind === 'accept') {
            if (!this.isHost) return;
            this._drawYes = this._drawYes || new Set();
            this._drawYes.add(d.token);
            this._tryResolveDraw();
        } else if (d.kind === 'reject') {
            if (!this.isHost) return;
            this._rejectDraw(d.name || '玩家');
        } else if (d.kind === 'reject-notice') {
            this._drawYes = null;
            this._setStatus('求和被拒绝', 'error');
            Utils.showMessage('求和被拒绝', 'warning');
        }
    }
    _tryResolveDraw() {
        const yes = this._drawYes || new Set();
        const gs = this.gameEngine && this.gameEngine.gameState;
        const elim = (gs && gs.eliminationOrder) || [];
        // 只需“仍在场上的参战玩家”（有颜色、已连上、未出局）全部同意；观战者与已出局者都不参与、不否决
        const need = this.participants
            .filter(p => p.id && (p.colors || []).length)
            .filter(p => !(p.colors || []).every(c => elim.includes(c)))
            .map(p => p.token);
        if (need.length && need.every(t => yes.has(t))) {
            this._drawYes = null;
            this.gameEngine.gameState.declareDraw();
            Utils.showMessage('全体同意，和棋', 'info');
            this.gameEngine.endGame();   // → onGameEnd → 广播 state（含 isDraw）
        }
    }
    _rejectDraw(who) {
        this._drawYes = null;
        this.actDraw.send({ kind: 'reject-notice' });
        this._setStatus(`求和被 ${who} 拒绝`, 'error');
        Utils.showMessage(`求和被 ${who} 拒绝`, 'warning');
    }

    // ================= 快照（仅加入/重同步用） =================
    /**
     * @param {{withHistory?: boolean}} [opts] withHistory=false 时不带 moveHistory。
     * 说明：moveHistory 每手约 155 B、随对局长度线性增长（一局 150 手就 20+ KB），是快照里最大的部分；
     * 而走子是**逐手广播**的，各端本地已累积了同样的历史 → 常规广播不必再带。
     * 只有“定向发给某个刚加入/请求重同步的 peer”时才需要带全量历史供其补齐。
     */
    _snapshot(opts) {
        const withHistory = !opts || opts.withHistory !== false;
        const gs = this.gameEngine.gameState;
        const d = {
            seq: this.seq,
            currentPlayer: gs.currentPlayer,
            turn: gs.turn,
            turnStartedAt: (this.gameEngine && this.gameEngine._turnStartedAt) || null,   // 各端据此对齐倒计时
            gamePhase: gs.gamePhase,
            startedAt: (this.gameEngine && this.gameEngine.gameStartTime) || null,
            winner: gs.winner,
            ranking: gs.ranking,
            isDraw: !!gs.isDraw,
            settings: this.settings,
            eliminationOrder: gs.eliminationOrder,
            eliminationLog: gs.eliminationLog,
            outOfPlay: gs.outOfPlay || [],
            undoLog: gs.undoLog || [],
            pieceCounts: gs.pieceCounts,
            board: gs.board.map(col => col.map(p => p ? { t: p.type, p: p.player, f: p.facing || null } : null))
        };
        if (withHistory) d.moveHistory = gs.moveHistory;
        return d;
    }
    _broadcastState() { this.seq++; this.actState.send(this._snapshot({ withHistory: false })); }

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
        this._hostFound();   // 收到房主快照 = 已找到房主
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
        gs.isDraw = !!d.isDraw;
        gs.eliminationOrder = d.eliminationOrder || [];
        gs.eliminationLog = d.eliminationLog || [];
        gs.outOfPlay = Array.isArray(d.outOfPlay) ? d.outOfPlay : [];
        gs.undoLog = Array.isArray(d.undoLog) ? d.undoLog : [];
        gs.pieceCounts = Object.assign({ 0: 0, 1: 0, 2: 0, 3: 0 }, d.pieceCounts);
        // 广播快照不带历史（各端已逐手累积）；只有定向快照才带来历史 → 没带就别覆盖本地的
        if (d.moveHistory) gs.moveHistory = this._deserializeHistory(d.moveHistory);
        gs.setRules(this.settings);
        gs.selectedPiece = null;
        gs.possibleMoves = [];

        ge.isGameActive = d.gamePhase === 'playing';
        // 同步本局开始时间（非房主原样没有 gameStartTime，导致结算显示“游戏时长：未知”）
        if (d.startedAt) ge.gameStartTime = d.startedAt;
        else if (!ge.gameStartTime && d.gamePhase === 'playing') ge.gameStartTime = Date.now();
        if (d.turnStartedAt) ge._serverTurnStartedAt = d.turnStartedAt;   // 倒计时按房主的“回合开始时间”对齐（刷新后接着走）
        ge.boardRenderer.clearSelection();
        ge.boardRenderer.renderPieces();
        ge.updateUI();
        if (ge.updateMoveHistory) ge.updateMoveHistory();
        if (window.gameInterface) {
            if (window.gameInterface.updateOnlinePanel) window.gameInterface.updateOnlinePanel();
            // 联机已开始：自动关闭设置弹窗
            if (d.gamePhase === 'playing' && window.gameInterface.closeSetup) window.gameInterface.closeSetup();
        }
        this._refreshStatus();
    }

    // ================= 结束 =================
    onGameEnd() {
        this._clearRecord();
        // 清掉本机单机存档，避免下次加载把这场联机局当单机继续
        if (this.gameEngine && this.gameEngine.persistence) this.gameEngine.persistence.clearSavedState();
        this._syncSettingsUI();   // 对局结束 → 解锁设置，便于为下一局调整
        this._renderRoster();     // 结束 → 房主管理里的“交换”按钮恢复
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
            seats: this.participants.map(p => ({
                name: p.name || '',
                colors: p.colors,
                host: p.token === this.token,
                online: p.token === this.token || !!p.id
            }))
        });
    }
    /** 名册 HTML（房主按 participants、非房主按广播的 _roster 渲染） */
    _rosterHtml() {
        const nameOf = (n, i) => Utils.escapeHtml(n ? n : `玩家${i + 1}`);
        const roleOf = s => (s.colors || []).length ? s.colors.map(c => Config.PLAYER_COLORS[c].name).join('+') : '待分配';
        if (this.isHost) {
            return this.participants.map((p, i) => {
                const online = p.token === this.token || p.id ? '' : '（离线）';
                return `<div>#${i + 1} ${nameOf(p.name, i)} ${p.token === this.token ? '(房主/你)' : online} — ${Utils.escapeHtml(roleOf(p))}</div>`;
            }).join('');
        }
        if (this._roster) {
            const d = this._roster;
            let html = `<div>房间内 ${d.count} 人</div>`;
            html += (d.seats || []).map((s, i) => {
                // 非房主视角：标出房主 / 自己 / 离线
                const tag = s.host ? '（房主）' : '';
                const you = (this.mySeat === i) ? '（你）' : '';
                const off = s.online === false ? '（离线）' : '';
                return `<div>#${i + 1} ${nameOf(s.name, i)} ${tag}${you}${off} — ${Utils.escapeHtml(roleOf(s))}</div>`;
            }).join('');
            return html;
        }
        return '';
    }

    /** 当前房间人数（房主按 participants，其余按名册广播） */
    _playerCount() {
        if (this.isHost) return this.participants.length;
        return (this._roster && typeof this._roster.count === 'number') ? this._roster.count : 0;
    }

    /** 按当前人数+模式预览座位分配（与 _groupsFor 一致） */
    _seatPreview(n) {
        const N = { 0: '红', 1: '蓝', 2: '绿', 3: '黑' };
        const cnt = Math.min(n, 4);
        if (this.settings.mode === Config.MODES.FFA) {
            const list = [0, 1, 2, 3].slice(0, cnt).map(c => N[c]).join('/');
            const rem = n < 4 ? `（${[0, 1, 2, 3].slice(Math.max(n, 0)).map(c => N[c]).join('/')} 移除）` : '';
            return cnt ? `各控一色：${list}${rem}` : '等待玩家';
        }
        if (cnt <= 1) return '等待玩家';
        if (cnt === 2) return '各控一队：红蓝 ｜ 绿黑';
        if (cnt === 3) return '红蓝(2人) vs 绿(1人)（黑移除）';
        return '各控一色：红蓝 vs 绿黑（2v2）';
    }

    /** 人数状态提示 */
    _countState() {
        // 非房主尚未收到房主名册：此时 _playerCount() 恒为 0，别把“还没连上”说成“0 人”
        if (this.active && !this.isHost && !this.started && !this._roster) return '正在连接房主…';
        const n = this._playerCount();
        const min = this._minPlayers();
        if (this.started) return '对局进行中';
        if (n > 4) return `已满（4 人），多出的 ${n - 4} 人将观战`;
        if (n < min) return `还差 ${min - n} 人可开始`;
        return '人数已满足，可开始';
    }

    _renderRoster() {
        const html = this._rosterHtml();
        const main = this.el && this.el.roster;
        if (main) main.innerHTML = html;
        const lobby = (typeof document !== 'undefined' && document.getElementById) ? document.getElementById('lobbyRoster') : null;
        if (lobby) lobby.innerHTML = html;
        this._renderAdmin();
        this._renderLobby();
        this._syncSettingsUI();   // 开局/结束/换人等时机刷新“设置是否锁定”
    }

    /** 大厅头部：房间号 + 人数/座位预览提示 */
    _renderLobby() {
        if (typeof document === 'undefined' || !document.getElementById) return;
        const code = document.getElementById('lobbyRoomCode');
        if (code) code.textContent = this.active ? (this.roomId || '—') : '—';
        const hint = document.getElementById('lobbyHint');
        if (!hint) return;
        if (!this.active) { hint.textContent = ''; hint.className = 'online-status'; return; }
        // 非房主尚未收到名册：区分“正在连”与“找不到房主 / 连不上”，别显示误导性的“当前 0 人”
        const connecting = !this.isHost && !this.started && !this._roster;
        if (connecting) {
            if (this._joinIssue) {
                const what = this._joinIssue === 'no-host' ? '未找到房主' : '无法连接到房主';
                hint.textContent = `${what}（房间号 ${this.roomId}）· 可点「重试连接」，或确认房间号与网络`;
                hint.className = 'online-status online-status--error';
            } else {
                hint.textContent = `正在连接房主…（房间号 ${this.roomId}）`;
                hint.className = 'online-status';
            }
            return;
        }
        hint.className = 'online-status';
        hint.textContent = `当前 ${this._playerCount()} 人 · ${this._seatPreview(this._playerCount())} · ${this._countState()}`;
    }

    /** 对局是否正在进行（进行中则禁止会扰动棋局的操作，如交换位置/颜色） */
    _inProgress() {
        const gs = this.gameEngine && this.gameEngine.gameState;
        return !!(this.active && this.started && gs && gs.gamePhase === 'playing');
    }

    /** 房主专用：玩家管理（交换位置/颜色、踢出） */
    _renderAdmin() {
        const el = document.getElementById ? document.getElementById('roomAdmin') : null;
        if (!el) return;
        if (!this.isHost || !this.active) { el.classList.add('hidden'); el.innerHTML = ''; return; }
        const canSwap = !this._inProgress();   // 对局进行中不允许交换位置/颜色
        const rows = this.participants.map((p, i) => {
            if (p.token === this.token) return '';
            const role = p.colors && p.colors.length ? p.colors.map(c => Config.PLAYER_COLORS[c].name).join('+') : '待分配';
            const off = p.id ? '' : '（离线）';
            const tk = Utils.escapeHtml(p.token);
            const swapBtn = canSwap ? `<button class="mini-btn" data-swap="${tk}">交换</button>` : '';
            return `<div class="admin-row"><span class="admin-name">#${i + 1} ${Utils.escapeHtml(p.name || ('玩家' + (i + 1)))} ${off} — ${Utils.escapeHtml(role)}</span>`
                + swapBtn
                + `<button class="mini-btn mini-btn--danger" data-kick="${tk}">踢出</button></div>`;
        }).join('');
        el.classList.remove('hidden');
        el.innerHTML = rows || '<div class="admin-empty">（暂无其他玩家）</div>';
        el.querySelectorAll('[data-swap]').forEach(b => b.addEventListener('click', () => this.swapWithHost(b.dataset.swap)));
        el.querySelectorAll('[data-kick]').forEach(b => b.addEventListener('click', () => {
            const p = this._findByToken(b.dataset.kick);
            Utils.confirmModal(`确定把「${p && p.name ? p.name : '该玩家'}」踢出房间吗？`).then(ok => {
                if (ok) this.kickParticipant(b.dataset.kick);
            });
        }));
    }

    /**
     * 房主：与某玩家交换“座位”（位置 + 颜色一起换）——直接交换数组里的两个条目，最不易出错。
     * 对局进行中禁止（开局前随便换）。
     */
    swapWithHost(token) {
        if (!this.isHost) return;
        if (this._inProgress()) { Utils.showMessage('对局进行中不能交换位置/颜色', 'warning'); return; }
        const i = this.participants.findIndex(x => x.token === this.token);
        const j = this.participants.findIndex(x => x.token === token);
        if (i < 0 || j < 0 || i === j) return;
        const hostEntry = this.participants[i];
        const peerEntry = this.participants[j];

        // 交换“座位”＝位置 + 颜色一起换：先互换颜色，再互换数组槽位
        const c = hostEntry.colors; hostEntry.colors = peerEntry.colors; peerEntry.colors = c;
        this.participants[i] = peerEntry;
        this.participants[j] = hostEntry;
        // 现在：房主在槽位 j（拿到对方原颜色）；对方在槽位 i（拿到房主原颜色）

        this._setMyColors(hostEntry.colors);
        if (this.started && peerEntry.id) {   // 开局前只是重排槽位（颜色在 startMatch 才分配），不必发 assign
            this.actAssign.send({ colors: peerEntry.colors, seat: i, hostId: this.selfId, settings: this.settings }, { target: peerEntry.id });
        }
        this._broadcastRoster();
        this._renderRoster();
        this._refreshStatus();
        this._saveRecord();
        Utils.showMessage('已交换位置/颜色', 'info');
    }

    /**
     * 房主：踢出一名玩家。开局中会把其颜色一并淘汰，保证棋盘/回合一致。
     */
    kickParticipant(token) {
        if (!this.isHost) return;
        const p = this._findByToken(token);
        if (!p || p.token === this.token) return;
        const ge = this.gameEngine, gs = ge.gameState;

        if (p.id) this.actKick.send({ text: '你已被房主移出房间' }, { target: p.id });

        const colors = (p.colors || []).slice();
        this._drawYes = null;                        // 作废未完成的求和
        if (this.started && gs.gamePhase === 'playing' && colors.length) {
            const removed = [];
            for (const c of colors) {
                if (!gs.hasKing(c)) continue;
                gs.eliminatePlayer(c);
                Utils.showMessage(`${Config.PLAYER_COLORS[c].name}被房主移出`, 'warning');
                removed.push(c);
            }
            if (gs.checkGameEnd()) {
                ge.endGame();
            } else {
                if (!gs.hasKing(gs.currentPlayer)) gs.nextPlayer();
                ge.boardRenderer.clearSelection();
                ge.boardRenderer.renderPieces();
            }
            ge.updateUI();
            if (ge.updateMoveHistory) ge.updateMoveHistory();
            this._broadcastEliminateMany(removed, 'kicked');
        }

        this.participants = this.participants.filter(x => x.token !== token);
        this._broadcastRoster();
        this._renderRoster();
        this._updateStartBtn();
        this._refreshStatus();
        this._saveRecord();
        this._checkOfflineTurn();   // 移出后回合/离线状态可能变化，重排或撤销计时
        Utils.showMessage(`已移出「${p.name || '玩家'}」`, 'info');
    }

    /** 非房主：收到被踢通知后离开房间 */
    _onKick(d) {
        if (this.isHost) return;
        Utils.showMessage((d && d.text) || '你已被房主移出房间', 'warning');
        this._setStatus('你已被房主移出房间', 'error');
        this.leave();
    }

    // ================= 聊天（自由文本 + 快捷语 + emoji） =================
    _wireChat() {
        const QUICK = ['你好', '好棋！', '快走啦', '手下留情', '再来一局', '😂'];
        const EMOJI = ['😀', '😂', '👍', '👎', '🎉', '😭', '😡', '🤔', '👏', '😅', '😎', '🐶', '❤️', '🙏'];
        const input = this.el.chatInput, send = this.el.chatSend, open = this.el.chatOpen;
        if (open) open.addEventListener('click', () => {
            this._chatUnread = 0; this._updateChatBtn();
            if (window.gameInterface && window.gameInterface.openModal) window.gameInterface.openModal('chatModal');
        });
        const doSend = () => { this.sendChat(input ? input.value : ''); if (input) { input.value = ''; input.focus(); } };
        if (send) send.addEventListener('click', doSend);
        if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSend(); } });
        if (this.el.chatQuick) {
            QUICK.forEach(t => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = t; b.addEventListener('click', () => this.sendChat(t)); this.el.chatQuick.appendChild(b); });
        }
        if (this.el.chatEmoji) {
            EMOJI.forEach(em => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip chip--emoji'; b.textContent = em; b.addEventListener('click', () => { if (input) { input.value += em; input.focus(); } }); this.el.chatEmoji.appendChild(b); });
        }
    }

    sendChat(text) {
        if (!this.active) return;
        text = String(text || '').trim().slice(0, 100);
        if (!text) return;
        const msg = {
            name: this.name || '玩家',
            color: (this.myColors && this.myColors.length) ? this.myColors[0] : null,
            text, ts: Date.now(), mine: true
        };
        this._appendChat(msg);
        try { this.actChat.send({ name: msg.name, color: msg.color, text: msg.text, ts: msg.ts }); } catch (e) { /* ignore */ }
    }
    _onChat(d) {
        if (!d || !d.text) return;
        this._appendChat({ name: d.name || '玩家', color: (d.color === undefined ? null : d.color), text: String(d.text).slice(0, 100), ts: d.ts });
    }
    _appendChat(msg) {
        if (!this._chatLog) this._chatLog = [];
        this._chatLog.push(msg);
        if (this._chatLog.length > 100) this._chatLog.shift();
        const el = this.el && this.el.chatLog;
        if (el && typeof document !== 'undefined') {
            const col = (msg.color != null && Config.PLAYER_COLORS[msg.color]) ? Config.PLAYER_COLORS[msg.color].color : '';
            const div = document.createElement('div');
            div.className = 'chat-line ' + col;
            div.innerHTML = `<b>${Utils.escapeHtml(msg.name || '玩家')}</b>：${Utils.escapeHtml(msg.text)}`;
            el.appendChild(div);
            el.scrollTop = el.scrollHeight;
            const modal = document.getElementById('chatModal');
            if (!msg.mine && modal && modal.classList.contains('hidden')) { this._chatUnread = (this._chatUnread || 0) + 1; this._updateChatBtn(); }
        }
    }
    _updateChatBtn() {
        const b = this.el && this.el.chatOpen;
        if (b) b.textContent = this._chatUnread ? `聊天 (${this._chatUnread})` : '聊天';
    }
    _updateStartBtn() {
        if (!this.el || !this.el.start) return;
        const min = this._minPlayers();
        const finished = this.gameEngine && this.gameEngine.gameState.gamePhase === 'finished';
        this.el.start.disabled = !(this.isHost && this.active && this.participants.length >= min && (!this.started || finished));
    }
    _setStatus(text, kind) {
        if (this.el && this.el.status) {
            this.el.status.textContent = text;
            this.el.status.className = 'online-status ' +
                (kind === 'error' ? 'online-status--error' : kind === 'ok' ? 'online-status--ok' : '');
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = OnlineSession;
    // 供测试引用实际时限，别在用例里硬编码（改时限不必改测试）
    module.exports.OFFLINE_SKIP_MS = OFFLINE_SKIP_MS;
    module.exports.HOST_WAIT_MS = HOST_WAIT_MS;
}
