// 音效：用 WebAudio 合成“落子”的短促木石声（无需音频资源，离线可用）。默认开启，可在设置里关闭。
class Sound {
    constructor() {
        this.enabled = false;
        this.ctx = null;
        this._noise = null;
    }

    setEnabled(on) {
        this.enabled = !!on;
        if (this.enabled) this._ensure();
    }

    _ensure() {
        if (this.ctx || typeof window === 'undefined') return;
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
    }

    _noiseBuf() {
        const ctx = this.ctx;
        if (!ctx) return null;
        if (this._noise) return this._noise;
        const len = Math.floor(ctx.sampleRate * 0.25);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this._noise = buf;
        return buf;
    }

    _tone(freq, dur, type = 'sine', gain = 0.07, delay = 0) {
        const ctx = this.ctx;
        if (!ctx) return;
        const t0 = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g); g.connect(ctx.destination);
        osc.start(t0); osc.stop(t0 + dur + 0.02);
    }

    /** “啪嗒”一记：带通噪声 + 低频木质尾音，模拟棋子落在棋盘上的声音 */
    _clack(freq, dur = 0.05, gain = 0.5, delay = 0, q = 1.1) {
        const ctx = this.ctx;
        if (!ctx) return;
        const t0 = ctx.currentTime + delay;
        const src = ctx.createBufferSource();
        src.buffer = this._noiseBuf();
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(freq, t0);
        bp.Q.setValueAtTime(q, t0);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(gain, t0 + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(bp); bp.connect(g); g.connect(ctx.destination);
        src.start(t0); src.stop(t0 + dur + 0.02);
        this._tone(freq * 0.5, dur * 1.3, 'sine', gain * 0.45, delay);   // 木质感
    }

    /** name: move | capture | check | end | undo | start */
    play(name) {
        if (!this.enabled) return;
        this._ensure();
        if (!this.ctx) return;
        try { if (this.ctx.state === 'suspended') this.ctx.resume(); } catch (e) { /* ignore */ }
        switch (name) {
            case 'move': this._clack(1500, 0.05, 0.5); break;
            case 'capture': this._clack(1900, 0.04, 0.55); this._clack(820, 0.08, 0.5, 0.05); break;
            case 'check': this._tone(880, 0.12, 'square', 0.05); this._tone(1320, 0.16, 'square', 0.05, 0.12); break;
            case 'end': [523, 659, 784, 1046].forEach((f, i) => this._tone(f, 0.16, 'sine', 0.06, i * 0.12)); break;
            case 'undo': this._tone(520, 0.1, 'sine', 0.05); this._tone(360, 0.14, 'sine', 0.05, 0.09); break;
            case 'start': this._clack(1200, 0.05, 0.4); break;
            default: break;
        }
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = Sound;
