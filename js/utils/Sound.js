// 音效：用 WebAudio 合成短音，无需音频资源文件（离线可用）。默认关闭，由设置开启。
class Sound {
    constructor() {
        this.enabled = false;
        this.ctx = null;
    }

    setEnabled(on) {
        this.enabled = !!on;
        if (this.enabled) this._ensure();
    }

    _ensure() {
        if (this.ctx || typeof window === 'undefined') return;
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
    }

    _tone(freq, dur, type = 'sine', gain = 0.08, delay = 0) {
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

    /** name: move | capture | check | end | undo | start */
    play(name) {
        if (!this.enabled) return;
        this._ensure();
        if (!this.ctx) return;
        try { if (this.ctx.state === 'suspended') this.ctx.resume(); } catch (e) { /* ignore */ }
        switch (name) {
            case 'move': this._tone(620, 0.07, 'triangle', 0.07); break;
            case 'capture':
                this._tone(300, 0.10, 'sawtooth', 0.07);
                this._tone(170, 0.13, 'sawtooth', 0.06, 0.06);
                break;
            case 'check':
                this._tone(880, 0.09, 'square', 0.05);
                this._tone(1174, 0.11, 'square', 0.05, 0.09);
                break;
            case 'end':
                [523, 659, 784, 1046].forEach((f, i) => this._tone(f, 0.16, 'sine', 0.06, i * 0.12));
                break;
            case 'undo': this._tone(430, 0.08, 'sine', 0.06); break;
            case 'start': this._tone(740, 0.10, 'triangle', 0.06); break;
            default: break;
        }
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = Sound;
