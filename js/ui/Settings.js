// 应用设置：深色模式 / 音效 / 记谱方式（持久化到 localStorage，自动保存）
class Settings {
    constructor() {
        this.KEY = 'chess4p_settings';
        this.data = Object.assign({ theme: 'light', sound: false }, this._load());
        this._bound = false;
        this.el = null;
    }

    _load() { try { return JSON.parse(localStorage.getItem(this.KEY) || '{}') || {}; } catch (e) { return {}; } }
    _save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ } }

    get theme() { return this.data.theme === 'dark' ? 'dark' : 'light'; }
    get soundEnabled() { return !!this.data.sound; }

    init() {
        this.apply();
        if (this._bound || typeof document === 'undefined') return;
        this._bound = true;
        const $ = id => document.getElementById(id);
        this.el = { dark: $('settingDark'), sound: $('settingSound'), open: $('settingsOpenBtn') };
        if (this.el.dark) {
            this.el.dark.checked = this.theme === 'dark';
            this.el.dark.addEventListener('change', () => this.setTheme(this.el.dark.checked ? 'dark' : 'light'));
        }
        if (this.el.sound) {
            this.el.sound.checked = this.soundEnabled;
            this.el.sound.addEventListener('change', () => this.setSound(this.el.sound.checked));
        }
        if (this.el.open && window.gameInterface) {
            this.el.open.addEventListener('click', () => window.gameInterface.openModal('settingsModal'));
        }
    }

    apply() {
        if (typeof document === 'undefined') return;
        const root = document.documentElement;
        if (root && root.setAttribute) root.setAttribute('data-theme', this.theme);
        if (window.sound && window.sound.setEnabled) window.sound.setEnabled(this.soundEnabled);
    }

    setTheme(v) { this.data.theme = v === 'dark' ? 'dark' : 'light'; this.apply(); this._save(); }
    setSound(v) { this.data.sound = !!v; this.apply(); this._save(); }
}

if (typeof module !== 'undefined' && module.exports) module.exports = Settings;
