// 对局回放：导出为纯文本(.txt，带签名)、导入后逐手查看
function cyrb53hex(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

class Replay {
    constructor(gameEngine) {
        this.ge = gameEngine;
        this.active = false;
        this.moves = [];
        this.meta = {};
        this.rules = null;
        this.index = 0;
        this.replayState = null;
        this._live = null;
        this._bound = false;
    }

    init() {
        if (this._bound || typeof document === 'undefined') return;
        this._bound = true;
        const $ = id => document.getElementById(id);
        this.el = {
            export: $('exportReplayBtn'),
            import: $('importReplayBtn'),
            file: $('importReplayInput'),
            controls: $('replayBar'),
            first: $('replayFirstBtn'),
            prev: $('replayPrevBtn'),
            next: $('replayNextBtn'),
            last: $('replayLastBtn'),
            exit: $('replayExitBtn'),
            status: $('replayStatus')
        };
        if (this.el.export) this.el.export.addEventListener('click', () => { this.exportFile().catch(() => {}); });
        if (this.el.import) this.el.import.addEventListener('click', () => { if (this.el.file) this.el.file.click(); });
        if (this.el.file) this.el.file.addEventListener('change', e => this._onFile(e));
        if (this.el.first) this.el.first.addEventListener('click', () => this.goto(0));
        if (this.el.prev) this.el.prev.addEventListener('click', () => this.goto(this.index - 1));
        if (this.el.next) this.el.next.addEventListener('click', () => this.goto(this.index + 1));
        if (this.el.last) this.el.last.addEventListener('click', () => this.goto(this.moves.length));
        if (this.el.exit) this.el.exit.addEventListener('click', () => this.exit());
    }

    _modeText(m) { return m === Config.MODES.FFA ? '四人混战' : '两两组队'; }
    _victoryText(v) { return v === Config.VICTORY.LAST_TEAM ? '仅剩一队' : '将死任意一方'; }
    _resultText(gs) {
        const w = gs.winner;
        if (w === 'TEAM1') return '红蓝队获胜';
        if (w === 'TEAM2') return '绿黑队获胜';
        if (typeof w === 'number') return Config.PLAYER_COLORS[w].name + ' 获胜';
        return '已结束';
    }

    // ---------- 导出 ----------
    async exportFile() {
        const gs = this.ge.gameState;
        const st = (window.onlineSession && window.onlineSession.settings) || Config.DEFAULT_RULES;
        const hist = gs.moveHistory || [];
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

        const lines = [];
        lines.push('四人象棋对局记录');
        lines.push('版本: 1');
        lines.push('时间: ' + ts);
        lines.push('模式: ' + this._modeText(st.mode));
        lines.push('胜利条件: ' + this._victoryText(st.victory));
        lines.push('友伤: ' + (st.friendlyFire ? '开' : '关'));
        lines.push('结果: ' + (gs.gamePhase === 'finished' ? this._resultText(gs) : '未结束'));
        lines.push('走子数: ' + hist.length);
        lines.push('走子:');
        hist.forEach((mv, i) => {
            const pname = Config.PLAYER_COLORS[mv.player].name;
            const piece = Config.PIECE_NAMES[mv.player][mv.piece];
            const cap = mv.captured ? ` 吃${Config.PIECE_NAMES[mv.captured.player][mv.captured.type]}` : '';
            lines.push(`${i + 1}. ${pname} ${piece} (${mv.from.x},${mv.from.y})->(${mv.to.x},${mv.to.y})${cap}`);
        });
        if (gs.eliminationLog && gs.eliminationLog.length) {
            gs.eliminationLog.forEach(e => lines.push(`淘汰 ${Config.PLAYER_COLORS[e.player].name} ${e.atMove}`));
        }

        const content = lines.join('\n');
        let signature = '';
        try { signature = await this._sign(content); } catch (e) { signature = ''; }
        const text = '签名: ' + signature + '\n' + content;

        try {
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `四人象棋_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.txt`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            Utils.showMessage('已导出回放（含签名）', 'success');
        } catch (e) {
            Utils.showMessage('导出失败: ' + e.message, 'error');
        }
    }

    /**
     * 计算签名：SHA-256(盐 + 正文)；无 WebCrypto 时退回 cyrb53
     */
    async _sign(text) {
        const full = Config.SIGN_SALT + '|' + text;
        if (globalThis.crypto && globalThis.crypto.subtle && globalThis.TextEncoder) {
            const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(full));
            return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        }
        return cyrb53hex(full);
    }

    /**
     * 校验签名（自动把盐拼回正文再算哈希比对）
     */
    async verify(data) {
        if (!data || !data.signature) return false;
        try { return (await this._sign(data.body)) === data.signature; } catch (e) { return false; }
    }

    // ---------- 导入 ----------
    _onFile(e) {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = async () => {
            try {
                const data = this.parse(String(r.result));
                if (data.signature) {
                    const ok = await this.verify(data);
                    if (!ok) Utils.showMessage('⚠️ 回放签名不匹配，文件可能被修改过', 'error');
                } else {
                    Utils.showMessage('该回放没有签名（可能被手动编辑过）', 'warning');
                }
                this.enter(data);
            } catch (err) {
                Utils.showMessage('回放文件解析失败: ' + err.message, 'error');
            }
        };
        r.readAsText(f);
        e.target.value = '';
    }

    parse(text) {
        let body = String(text);
        let signature = null;
        const nl = body.indexOf('\n');
        if (nl >= 0) {
            const sm = body.slice(0, nl).trim().match(/^签名[:：]\s*(.*)$/);
            if (sm) { signature = sm[1].trim(); body = body.slice(nl + 1); }
        }
        const meta = {};
        const moves = [];
        const eliminations = [];
        for (const raw of body.split(/\r?\n/)) {
            const line = raw.trim();
            if (!line) continue;
            const m = line.match(/^(\d+)\.\s*\S+\s+\S+\s*\((\d+),(\d+)\)->\((\d+),(\d+)\)/);
            if (m) { moves.push({ from: [+m[2], +m[3]], to: [+m[4], +m[5]] }); continue; }
            const em = line.match(/^淘汰\s+(\S+)\s+(\d+)$/);
            if (em) {
                const idx = Object.keys(Config.PLAYER_COLORS).find(k => Config.PLAYER_COLORS[k].name === em[1]);
                if (idx !== undefined) eliminations.push({ player: +idx, atMove: +em[2] });
                continue;
            }
            const kv = line.match(/^([^:：]+)[:：]\s*(.*)$/);
            if (kv) meta[kv[1].trim()] = kv[2].trim();
        }
        if (!moves.length) throw new Error('未找到走子记录');
        const rules = Object.assign({}, Config.DEFAULT_RULES);
        if (meta['模式'] === '四人混战') rules.mode = Config.MODES.FFA;
        if (meta['胜利条件'] === '仅剩一队') rules.victory = Config.VICTORY.LAST_TEAM;
        if (meta['友伤'] === '开') rules.friendlyFire = true;
        return { meta, moves, rules, eliminations, signature, body };
    }

    // ---------- 回放 ----------
    enter(data) {
        if (!data || !data.moves || !data.moves.length) return;
        this.meta = data.meta || {};
        this.moves = data.moves;
        this.eliminations = data.eliminations || [];
        this.rules = data.rules || Config.DEFAULT_RULES;
        const br = this.ge.boardRenderer;
        this._live = br.gameState;
        this.active = true;
        if (br.boardElement) br.boardElement.style.pointerEvents = 'none';
        this.goto(0);
        if (this.el) {
            if (this.el.controls) this.el.controls.classList.remove('hidden');
            if (this.el.export) this.el.export.disabled = true;
            if (this.el.import) this.el.import.disabled = true;
        }
        // 关掉弹窗露出棋盘
        if (window.gameInterface && window.gameInterface.closeReplay) window.gameInterface.closeReplay();
        Utils.showMessage('已载入回放，可逐手查看', 'success');
    }

    goto(index) {
        if (!this.active) return;
        index = Math.max(0, Math.min(index, this.moves.length));
        const gs = new GameState();
        gs.setRules(this.rules);
        for (let k = 0; k < index; k++) this._applyRaw(gs, this.moves[k].from, this.moves[k].to);
        // 应用已经发生的淘汰（atMove <= 当前步数）
        const elims = (this.eliminations || []).filter(e => e.atMove <= index).sort((a, b) => a.atMove - b.atMove);
        for (const e of elims) {
            for (let x = 0; x < Config.BOARD_SIZE; x++) {
                for (let y = 0; y < Config.BOARD_SIZE; y++) {
                    const pc = gs.board[x][y];
                    if (pc && pc.player === e.player) gs.board[x][y] = null;
                }
            }
        }
        this.replayState = gs;
        this.index = index;

        const br = this.ge.boardRenderer;
        br.gameState = gs;
        br.clearSelection();
        br.renderPieces();

        if (this.el && this.el.status) {
            const last = index > 0 ? this.moves[index - 1] : null;
            const mv = last ? `(${last.from[0]},${last.from[1]})->(${last.to[0]},${last.to[1]})` : '初始局面';
            this.el.status.textContent = `回放 ${index}/${this.moves.length} 步：${mv}`;
        }
    }

    _applyRaw(gs, from, to) {
        const pc = gs.getPiece(from[0], from[1]);
        if (!pc) return;
        gs.board[to[0]][to[1]] = pc;
        pc.x = to[0]; pc.y = to[1];
        gs.board[from[0]][from[1]] = null;
    }

    exit() {
        if (!this.active) return;
        this.active = false;
        const br = this.ge.boardRenderer;
        br.gameState = this._live;
        if (br.boardElement) br.boardElement.style.pointerEvents = '';
        br.clearSelection();
        br.renderPieces();
        if (this.el) {
            if (this.el.controls) this.el.controls.classList.add('hidden');
            if (this.el.export) this.el.export.disabled = false;
            if (this.el.import) this.el.import.disabled = false;
            if (this.el.status) this.el.status.textContent = '';
        }
        Utils.showMessage('已退出回放', 'info');
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = Replay;
