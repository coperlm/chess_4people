// 联机对局（Trystero 免服务器 P2P，房主权威）
// - 房主：持有权威 GameState/RuleValidator，校验并广播状态
// - 玩家：只发送“意图”，接收并应用房主广播的状态快照
class OnlineSession {
    constructor(gameEngine) {
        this.gameEngine = gameEngine;
        this.appId = 'chess-4people-v1';

        this.room = null;
        this.roomId = null;
        this.isHost = false;
        this.active = false;
        this.started = false;
        this.selfId = null;
        this.hostId = null;
        this.myColors = [];
        this.name = '';
        this.mode = 'auto';       // 'auto' | '2' | '4'
        this.participants = [];   // 房主维护：[{ id, colors:[], name }]
        this._roster = null;      // 玩家侧收到的名册
        this.seq = 0;
        this._lastSeq = 0;
        this._bound = false;
    }

    // ================= 初始化 / UI 绑定 =================
    init() {
        if (this._bound || typeof document === 'undefined') return;
        this._bound = true;
        const $ = id => document.getElementById(id);
        this.el = {
            code: $('roomCodeInput'),
            name: $('playerNameInput'),
            mode: $('modeSelect'),
            create: $('createRoomBtn'),
            join: $('joinRoomBtn'),
            status: $('onlineStatus'),
            roster: $('onlineRoster'),
            start: $('startOnlineBtn'),
            leave: $('leaveRoomBtn')
        };
        if (this.el.mode) this.el.mode.addEventListener('change', () => this._updateStartBtn());
        if (this.el.create) this.el.create.addEventListener('click', () => this._onCreate());
        if (this.el.join) this.el.join.addEventListener('click', () => this._onJoin());
        if (this.el.start) this.el.start.addEventListener('click', () => this.startMatch());
        if (this.el.leave) this.el.leave.addEventListener('click', () => this.leave());
    }

    // ================= 房间创建 / 加入 =================
    _genCode() {
        const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
        let s = '';
        for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
        return s;
    }
    _validCode(c) { return /^[a-z0-9]{3,8}$/i.test(c || ''); }

    _onCreate() {
        const code = (this.el.code && this.el.code.value.trim()) || this._genCode();
        if (!this._validCode(code)) return this._setStatus('房间号需为 3-8 位字母或数字', 'error');
        if (this.el.code) this.el.code.value = code;
        this._open(code.toLowerCase(), true);
    }
    _onJoin() {
        const code = this.el.code ? this.el.code.value.trim() : '';
        if (!this._validCode(code)) return this._setStatus('请输入正确的房间号', 'error');
        this._open(code.toLowerCase(), false);
    }

    _open(roomId, isHost) {
        if (typeof Trystero === 'undefined' || !Trystero.joinRoom) {
            this._setStatus('联机组件未加载（vendor/trystero.nostr.iife.js）', 'error');
            return;
        }
        this.leave();

        this.roomId = roomId;
        this.isHost = isHost;
        this.hostId = isHost ? null : null;
        this.active = true;
        this.started = false;
        this.seq = 0;
        this._lastSeq = 0;
        this.myColors = [];
        this.participants = [];
        this.name = (this.el && this.el.name && this.el.name.value.trim()) || '';
        if (isHost && this.el && this.el.mode) this.mode = this.el.mode.value;

        try {
            this.room = Trystero.joinRoom({ appId: this.appId, password: this.roomId }, this.roomId);
        } catch (e) {
            this.active = false;
            this._setStatus('加入房间失败: ' + (e && e.message), 'error');
            return;
        }
        this.selfId = this.room.selfId || Trystero.selfId;

        // 动作通道
        this.actAssign = this.room.makeAction('assign');
        this.actRoster = this.room.makeAction('roster');
        this.actIntent = this.room.makeAction('intent');
        this.actState = this.room.makeAction('state');
        this.actNotice = this.room.makeAction('notice');
        this.actHello = this.room.makeAction('hello');

        this.actAssign.onMessage = d => this._onAssign(d);
        this.actRoster.onMessage = d => this._onRoster(d);
        this.actState.onMessage = d => this._onState(d);
        this.actNotice.onMessage = d => this._onNotice(d);
        this.actIntent.onMessage = (d, ctx) => this._onIntent(d, ctx.peerId);
        this.actHello.onMessage = (d, ctx) => this._onHello(d, ctx.peerId);

        this.room.onPeerJoin = id => this._onPeerJoin(id);
        this.room.onPeerLeave = id => this._onPeerLeave(id);

        if (isHost) {
            this.hostId = this.selfId;
            this.participants = [{ id: this.selfId, colors: [], name: this.name }];
            this._setStatus(`已创建房间「${this.roomId}」，把房间号发给朋友，等待加入…`, 'ok');
        } else {
            this._setStatus(`正在加入房间「${this.roomId}」…`, 'ok');
        }
        if (this.el && this.el.mode) this.el.mode.disabled = !isHost;

        this._applyNetworkMode(true);
        if (this.el) {
            if (this.el.leave) this.el.leave.classList.remove('hidden');
            if (this.el.create) this.el.create.disabled = true;
            if (this.el.join) this.el.join.disabled = true;
            if (this.el.start) this.el.start.classList.toggle('hidden', !isHost);
        }
        this._renderRoster();
        this._updateStartBtn();
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
        this._applyNetworkMode(false);
        if (this.el) {
            if (this.el.leave) this.el.leave.classList.add('hidden');
            if (this.el.create) this.el.create.disabled = false;
            if (this.el.join) this.el.join.disabled = false;
            if (this.el.start) this.el.start.classList.add('hidden');
            if (this.el.mode) this.el.mode.disabled = false;
        }
        this._renderRoster();
        if (this._bound) this._setStatus('未联机', '');
    }

    // ================= 座位 / 开局 =================
    _groupsFor(n) {
        if (this.mode === '2') return [[0, 1], [2, 3]];
        if (this.mode === '4') return [[0], [1], [2], [3]];
        if (n >= 4) return [[0], [1], [2], [3]];
        if (n === 3) return [[0], [1], [2, 3]];
        if (n === 2) return [[0, 1], [2, 3]];
        return [[0, 1, 2, 3]];
    }

    startMatch() {
        if (!this.active || !this.isHost || this.started) return;
        if (this.el && this.el.mode) this.mode = this.el.mode.value;
        const n = this.participants.length;
        if (n < 2) { this._setStatus('至少需要 2 名玩家才能开始', 'error'); return; }
        if (this.mode === '4' && n < 4) { this._setStatus(`四人对战需要 4 名玩家（当前 ${n} 人）`, 'error'); return; }

        const groups = this._groupsFor(n);
        this.participants.forEach((p, i) => { p.colors = groups[i] || []; });

        for (const p of this.participants) {
            if (p.id === this.selfId) this._setMyColors(p.colors);
            else this.actAssign.send({ colors: p.colors, hostId: this.selfId }, { target: p.id });
        }

        this.started = true;
        this.gameEngine.startNewGame();   // 房主权威开局
        this._broadcastRoster();
        this._broadcastState();
        this.actNotice.send({ text: '对局开始！' });
        this._renderRoster();
        this._updateStartBtn();
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

    // ================= 消息处理 =================
    _onPeerJoin(peerId) {
        if (this.isHost) {
            if (!this.participants.some(p => p.id === peerId)) {
                this.participants.push({ id: peerId, colors: [], name: '' });
            }
            this._broadcastRoster();
            if (this.started) {
                const p = this.participants.find(p => p.id === peerId);
                if (p) this.actAssign.send({ colors: p.colors, hostId: this.selfId }, { target: peerId });
                this.actState.send(this._snapshot(), { target: peerId });
            }
            this._renderRoster();
            this._updateStartBtn();
        } else {
            // 玩家侧：向房主报到昵称
            this._sendHello();
        }
    }
    _onPeerLeave(peerId) {
        if (this.isHost) {
            this.participants = this.participants.filter(p => p.id !== peerId);
            this._broadcastRoster();
            this._renderRoster();
            this._updateStartBtn();
        } else if (peerId === this.hostId) {
            this._setStatus('房主已离开，对局结束', 'error');
            this.active = false;
            this.started = false;
            this._applyNetworkMode(false);
        }
    }

    _sendHello() {
        if (!this.isHost && this.room) this.actHello.send({ name: this.name });
    }
    _onHello(d, peerId) {
        if (!this.isHost || !d) return;
        const p = this.participants.find(p => p.id === peerId);
        if (p) {
            p.name = d.name || '';
            this._broadcastRoster();
            this._renderRoster();
        }
    }

    _onAssign(d) {
        if (this.isHost) return;
        if (d.hostId) this.hostId = d.hostId;
        this.started = true;
        this._setMyColors(d.colors || []);
    }

    _onRoster(d) {
        this._roster = d;
        if (d && d.hostId) this.hostId = d.hostId;
        if (!this.isHost) {
            if (d && d.started) this.started = true;
            this._renderRoster();
        }
    }

    _onNotice(d) {
        if (d && d.text) {
            Utils.showMessage(d.text, 'info');
            this._setStatus(d.text, 'ok');
        }
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
            this._hostApply(d.from[0], d.from[1], d.to[0], d.to[1]);
        } else if (d.kind === 'undo') {
            if (gs.undoMove()) {
                this.gameEngine.boardRenderer.renderPieces();
                this.gameEngine.updateUI();
                this._broadcastState();
                this.actNotice.send({ text: '已悔棋' });
            }
        } else if (d.kind === 'resign') {
            this._hostResign(d.color);
        }
    }

    _reject(peerId, text) {
        this.actNotice.send({ text }, { target: peerId });
    }

    // ================= 走子（房主侧） =================
    _hostApply(fromX, fromY, toX, toY) {
        const ge = this.gameEngine;
        const gs = ge.gameState;
        if (!gs.movePiece(fromX, fromY, toX, toY)) return;
        ge.boardRenderer.clearSelection();
        ge.boardRenderer.renderPieces();
        ge.onMoveCompleted();          // 将死/结束/历史/存档/UI
        this._broadcastState();
    }

    _hostResign(color) {
        const gs = this.gameEngine.gameState;
        if (gs.gamePhase !== 'playing') return;
        gs.gamePhase = 'finished';
        gs.winner = Config.TEAMS.TEAM1.includes(color) ? 'TEAM2' : 'TEAM1';
        this.gameEngine.endGame();
        this.actNotice.send({ text: `${Config.PLAYER_COLORS[color].name} 认输` });
        this._broadcastState();
    }

    // ================= 玩家侧请求 =================
    requestMove(fromX, fromY, toX, toY) {
        if (!this.active || !this.started) return;
        if (this.isHost) this._hostApply(fromX, fromY, toX, toY);
        else this.actIntent.send({ kind: 'move', from: [fromX, fromY], to: [toX, toY] });
    }
    requestUndo() {
        if (!this.active || !this.started) return;
        if (this.isHost) {
            const gs = this.gameEngine.gameState;
            if (gs.undoMove()) {
                this.gameEngine.boardRenderer.renderPieces();
                this.gameEngine.updateUI();
                this._broadcastState();
            }
        } else this.actIntent.send({ kind: 'undo' });
    }
    requestResign(color) {
        if (!this.active || !this.started) return;
        if (this.isHost) this._hostResign(color);
        else this.actIntent.send({ kind: 'resign', color });
    }

    // ================= 状态快照 =================
    _snapshot() {
        const gs = this.gameEngine.gameState;
        return {
            seq: this.seq,
            currentPlayer: gs.currentPlayer,
            turn: gs.turn,
            gamePhase: gs.gamePhase,
            winner: gs.winner,
            pieceCounts: gs.pieceCounts,
            board: gs.board.map(col => col.map(p => p ? { t: p.type, p: p.player, f: p.facing || null } : null))
        };
    }
    _broadcastState() {
        this.seq++;
        this.actState.send(this._snapshot());
    }

    _onState(d) {
        if (this.isHost || !d) return;
        if (d.seq <= this._lastSeq) return;
        this._lastSeq = d.seq;

        const ge = this.gameEngine;
        const gs = ge.gameState;
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
        gs.pieceCounts = Object.assign({ 0: 0, 1: 0, 2: 0, 3: 0 }, d.pieceCounts);
        gs.selectedPiece = null;
        gs.possibleMoves = [];

        ge.isGameActive = d.gamePhase === 'playing';
        ge.boardRenderer.clearSelection();
        ge.boardRenderer.renderPieces();
        ge.updateUI();
        if (ge.updateMoveHistory) ge.updateMoveHistory();

        if (d.gamePhase === 'finished') {
            const w = d.winner === 'TEAM1' ? '红蓝队获胜' : d.winner === 'TEAM2' ? '绿黑队获胜' : '对局结束';
            this._setStatus(w, 'ok');
        }
    }

    // ================= 名册 / UI =================
    _broadcastRoster() {
        this.actRoster.send({
            hostId: this.selfId,
            count: this.participants.length,
            started: this.started,
            mode: this.mode,
            seats: this.participants.map(p => ({ name: p.name || '', colors: p.colors }))
        });
    }
    _renderRoster() {
        if (!this.el || !this.el.roster) return;
        const nameOf = (n, i) => Utils.escapeHtml(n ? n : `玩家${i + 1}`);
        if (this.isHost) {
            this.el.roster.innerHTML = this.participants.map((p, i) => {
                const role = p.colors.length ? p.colors.map(c => Config.PLAYER_COLORS[c].name).join('+') : '待分配';
                return `<div>#${i + 1} ${nameOf(p.name, i)} ${p.id === this.selfId ? '(房主/你)' : ''} — ${Utils.escapeHtml(role)}</div>`;
            }).join('');
        } else if (this._roster) {
            const d = this._roster;
            let html = `<div>房间内 ${d.count} 人${d.mode && d.mode !== 'auto' ? '（' + d.mode + '人模式）' : ''}</div>`;
            const seats = d.seats || (d.assignments || []).map(cs => ({ name: '', colors: cs }));
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
        const mode = this.el.mode ? this.el.mode.value : this.mode;
        const min = mode === '4' ? 4 : 2;
        this.el.start.disabled = !(this.isHost && this.active && !this.started && this.participants.length >= min);
    }
    _setStatus(text, kind) {
        if (this.el && this.el.status) {
            this.el.status.textContent = text;
            this.el.status.className = 'text-xs mt-2 ' +
                (kind === 'error' ? 'text-red-600' : kind === 'ok' ? 'text-green-700' : 'text-gray-600');
        }
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = OnlineSession;
