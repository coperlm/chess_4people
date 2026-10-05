// 对局回放：导出为单行编码文件(.xq4，内含签名，无法被篡改)、导入后逐手查看
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
            status: $('replayStatus'),
            sig: $('replaySig')
        };
        if (this.el.export) this.el.export.addEventListener('click', () => { this.exportFile().catch(() => {}); });
        if (this.el.import) this.el.import.addEventListener('click', () => { if (this.el.file) this.el.file.click(); });
        if (this.el.file) this.el.file.addEventListener('change', e => this._onFile(e));
        if (this.el.first) this.el.first.addEventListener('click', () => this.goto(0));
        if (this.el.prev) this.el.prev.addEventListener('click', () => this.goto(this.index - 1));
        if (this.el.next) this.el.next.addEventListener('click', () => this.goto(this.index + 1));
        if (this.el.last) this.el.last.addEventListener('click', () => this.goto(this.moves.length));
        if (this.el.exit) this.el.exit.addEventListener('click', () => this.exit());

        // 无障碍标注
        const labels = { first: '回到开头', prev: '上一步', next: '下一步', last: '跳到结尾', exit: '退出回放' };
        Object.keys(labels).forEach(k => { if (this.el[k]) this.el[k].setAttribute('aria-label', labels[k]); });
    }

    // ---------- 导出 ----------
    async exportFile() {
        const gs = this.ge.gameState;
        const st = (window.onlineSession && window.onlineSession.settings) || Config.DEFAULT_RULES;
        const hist = gs.moveHistory || [];
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');

        // 单行编码导出：<base64(JSON)>.<签名>。人不可读，但内容完整、校验不可篡改。
        const payload = {
            v: 1,
            t: now.toISOString(),
            r: { m: st.mode, v: st.victory, f: st.friendlyFire ? 1 : 0 },
            w: gs.isDraw ? 'draw' : (gs.winner === null || gs.winner === undefined ? null : gs.winner),
            g: gs.gamePhase === 'finished' ? 1 : 0,
            moves: hist.map(mv => [mv.from.x, mv.from.y, mv.to.x, mv.to.y]),
            elim: (gs.eliminationLog || []).map(e => [e.player, e.atMove]),
            rem: gs.outOfPlay || []     // 开局即移除的颜色（如 3 人组队去掉的第 4 色）
        };
        let encoded = '';
        try { encoded = btoa(JSON.stringify(payload)); } catch (e) { encoded = ''; }   // payload 全为 ASCII
        let signature = '';
        try { signature = await this._sign(encoded); } catch (e) { signature = ''; }
        const text = encoded + '.' + signature;

        try {
            const blob = new Blob([text], { type: 'application/octet-stream' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `四人象棋_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.xq4`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            Utils.showMessage('已导出回放（含签名，文件被改过将无法导入）', 'success');
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

    _setSigStatus(text, kind) {
        if (!this.el || !this.el.sig) return;
        this.el.sig.textContent = text;
        this.el.sig.className = 'online-status ' + (kind === 'bad' ? 'online-status--error' : kind === 'warn' ? '' : 'online-status--ok');
        if (kind === 'warn') this.el.sig.style.color = '#b45309';
        else this.el.sig.style.color = '';
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
                    if (!ok) {
                        // 签名不符 = 文件被改过 → 直接拒收，不允许导入
                        this._setSigStatus('❌ 签名校验不通过：文件已被修改，已拒绝导入', 'bad');
                        Utils.showMessage('回放签名不匹配（文件被修改过），已拒绝导入', 'error');
                        return;
                    }
                    this._setSigStatus('签名校验：通过 ✅', 'ok');
                } else {
                    // 旧格式无签名、无法校验：仅提示，仍可查看
                    this._setSigStatus('无签名（旧格式，无法校验）', 'warn');
                    Utils.showMessage('该回放没有签名（可能是旧格式或已被手动编辑），仅供参考', 'warning');
                }
                if (!data.moves.length) { Utils.showMessage('该对局还没有走子记录', 'info'); return; }
                this.enter(data);
            } catch (err) {
                Utils.showMessage('回放文件解析失败: ' + err.message, 'error');
            }
        };
        r.readAsText(f);
        e.target.value = '';
    }

    parse(text) {
        const rawText = String(text).trim();
        // 新格式：单行 <base64>.<签名>
        const single = rawText.match(/^([A-Za-z0-9+/=]+)\.([0-9a-f]{8,})$/);
        if (single) {
            const encoded = single[1], signature = single[2];
            let obj = null;
            try { obj = JSON.parse(atob(encoded)); } catch (e) { obj = null; }
            if (obj && Array.isArray(obj.moves)) {
                const rules = Object.assign({}, Config.DEFAULT_RULES);
                if (obj.r) { rules.mode = obj.r.m; rules.victory = obj.r.v; rules.friendlyFire = !!obj.r.f; }
                return {
                    meta: { 时间: String(obj.t || ''), 版本: String(obj.v || 1) },
                    moves: obj.moves.map(a => ({ from: [a[0], a[1]], to: [a[2], a[3]] })),
                    rules,
                    eliminations: (obj.elim || []).map(a => ({ player: a[0], atMove: a[1] })),
                    outOfPlay: obj.rem || [],
                    signature, body: encoded,
                    result: obj.w, finished: !!obj.g
                };
            }
            throw new Error('回放数据解析失败');
        }

        // 旧格式（多行文本）兼容解析
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
        let headerSeen = false;
        for (const raw of body.split(/\r?\n/)) {
            const line = raw.trim();
            if (!line) continue;
            if (/^四人象棋对局记录/.test(line)) { headerSeen = true; continue; }
            const m = line.match(/^(\d+)\.\s*\S+\s+\S+\s*\((\d+),(\d+)\)->\((\d+),(\d+)\)/);
            if (m) { moves.push({ from: [+m[2], +m[3]], to: [+m[4], +m[5]] }); continue; }
            const em = line.match(/^淘汰\s+(\S+)\s+(\d+)$/);
            if (em) {
                const idx = Object.keys(Config.PLAYER_COLORS).find(k => Config.PLAYER_COLORS[k].name === em[1]);
                if (idx !== undefined) eliminations.push({ player: +idx, atMove: +em[2] });
                continue;
            }
            const kv = line.match(/^([^:：]+)[:：]\s*(.*)$/);
            if (kv) {
                meta[kv[1].trim()] = kv[2].trim();
                if (kv[1].trim() === '走子数') headerSeen = true;
            }
        }
        // 完全没有走子时：只要有本平台的头部标记，就当作“空对局”而非报错
        if (!moves.length && !headerSeen) throw new Error('不是有效的对局记录');
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
        this.outOfPlay = data.outOfPlay || [];
        this.rules = data.rules || Config.DEFAULT_RULES;
        this.descriptors = this._buildDescriptors(this.moves);
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
        if (gs.removeColor) for (const c of (this.outOfPlay || [])) gs.removeColor(c);
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
            const mv = last ? Notation.span({ x: last.from[0], y: last.from[1] }, { x: last.to[0], y: last.to[1] }) : '初始局面';
            this.el.status.textContent = `回放 ${index}/${this.moves.length} 步：${mv}`;
        }
        this._renderMoveList();
    }

    /** 预演一遍，得到每步的 颜色/棋子/是否吃子（用于渲染走法列表） */
    _buildDescriptors(moves) {
        const gs = new GameState();
        gs.setRules(this.rules);
        if (gs.removeColor) for (const c of (this.outOfPlay || [])) gs.removeColor(c);
        const out = [];
        for (const mv of moves) {
            const pc = gs.getPiece(mv.from[0], mv.from[1]);
            const cap = gs.getPiece(mv.to[0], mv.to[1]);
            if (!pc) { out.push(null); continue; }
            out.push({
                player: pc.player, piece: pc.type,
                from: { x: mv.from[0], y: mv.from[1] },
                to: { x: mv.to[0], y: mv.to[1] },
                captured: cap ? { player: cap.player, type: cap.type } : null
            });
            gs.board[mv.to[0]][mv.to[1]] = pc; pc.x = mv.to[0]; pc.y = mv.to[1];
            gs.board[mv.from[0]][mv.from[1]] = null;
        }
        return out;
    }

    /** 在“移动历史”面板列出回放走法，高亮当前步，点击可跳转 */
    _renderMoveList() {
        if (typeof document === 'undefined') return;
        const el = document.getElementById('moveHistory');
        if (!el) return;
        const parts = [];
        for (let i = 0; i < this.moves.length; i++) {
            const d = this.descriptors && this.descriptors[i];
            const txt = d ? Notation.format(d)
                : Notation.span({ x: this.moves[i].from[0], y: this.moves[i].from[1] }, { x: this.moves[i].to[0], y: this.moves[i].to[1] });
            const cls = d ? Config.PLAYER_COLORS[d.player].color : '';
            const mark = (i + 1 === this.index) ? ' replay-move--active' : ((i + 1 < this.index) ? ' replay-move--past' : '');
            parts.push(`<div class="text-sm replay-move${mark} ${cls}" data-idx="${i + 1}">${i + 1}. ${txt}</div>`);
        }
        el.innerHTML = parts.join('') || '<p class="text-gray-500 text-sm">（空对局）</p>';
        el.querySelectorAll('.replay-move').forEach(node => {
            node.addEventListener('click', () => this.goto(parseInt(node.dataset.idx, 10)));
        });
        const cur = el.querySelector('.replay-move--active');
        if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
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
        // 恢复“实时对局”的移动历史显示
        if (window.gameEngine && window.gameEngine.updateMoveHistory) window.gameEngine.updateMoveHistory();
        Utils.showMessage('已退出回放', 'info');
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = Replay;
