// 对局回放：导出为纯文本(.txt)、导入后逐手查看
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
            controls: $('replayControls'),
            first: $('replayFirstBtn'),
            prev: $('replayPrevBtn'),
            next: $('replayNextBtn'),
            last: $('replayLastBtn'),
            exit: $('replayExitBtn'),
            status: $('replayStatus')
        };
        if (this.el.export) this.el.export.addEventListener('click', () => this.exportFile());
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
    exportFile() {
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

        const text = lines.join('\n') + '\n';
        try {
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `四人象棋_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.txt`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            Utils.showMessage('已导出回放', 'success');
        } catch (e) {
            Utils.showMessage('导出失败: ' + e.message, 'error');
        }
    }

    // ---------- 导入 ----------
    _onFile(e) {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => {
            try {
                const data = this.parse(String(r.result));
                this.enter(data);
            } catch (err) {
                Utils.showMessage('回放文件解析失败: ' + err.message, 'error');
            }
        };
        r.readAsText(f);
        e.target.value = '';
    }

    parse(text) {
        const meta = {};
        const moves = [];
        for (const raw of String(text).split(/\r?\n/)) {
            const line = raw.trim();
            if (!line) continue;
            const m = line.match(/^(\d+)\.\s*\S+\s+\S+\s*\((\d+),(\d+)\)->\((\d+),(\d+)\)/);
            if (m) { moves.push({ from: [+m[2], +m[3]], to: [+m[4], +m[5]] }); continue; }
            const kv = line.match(/^([^:：]+)[:：]\s*(.*)$/);
            if (kv) meta[kv[1].trim()] = kv[2].trim();
        }
        if (!moves.length) throw new Error('未找到走子记录');
        const rules = Object.assign({}, Config.DEFAULT_RULES);
        if (meta['模式'] === '四人混战') rules.mode = Config.MODES.FFA;
        if (meta['胜利条件'] === '仅剩一队') rules.victory = Config.VICTORY.LAST_TEAM;
        if (meta['友伤'] === '开') rules.friendlyFire = true;
        return { meta, moves, rules };
    }

    // ---------- 回放 ----------
    enter(data) {
        if (!data || !data.moves || !data.moves.length) return;
        this.meta = data.meta || {};
        this.moves = data.moves;
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
        Utils.showMessage('已载入回放，可逐手查看', 'success');
    }

    goto(index) {
        if (!this.active) return;
        index = Math.max(0, Math.min(index, this.moves.length));
        const gs = new GameState();
        gs.setRules(this.rules);
        for (let k = 0; k < index; k++) this._applyRaw(gs, this.moves[k].from, this.moves[k].to);
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
