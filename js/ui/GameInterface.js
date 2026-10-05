// 游戏界面管理器
class GameInterface {
    constructor(gameEngine) {
        this.gameEngine = gameEngine;
        this.gameEngine.gameInterface = this;
        this.configured = false;   // 是否已做过对局设置（未设置不允许开局）
        
        // 联机会话（Trystero）
        this.onlineSession = null;
        if (typeof OnlineSession !== 'undefined') {
            this.onlineSession = new OnlineSession(gameEngine);
            this.onlineSession.init();
            window.onlineSession = this.onlineSession;
        }
        
        // 对局回放
        this.replay = null;
        if (typeof Replay !== 'undefined') {
            this.replay = new Replay(gameEngine);
            this.replay.init();
            window.replay = this.replay;
        }
        
        this.initialize();
    }
    
    /**
     * 初始化界面
     */
    initialize() {
        this.setupResponsiveLayout();
        this.initializeTooltips();
        this.updateInterface();
        this._wireSetup();
        this.openSetup(); // 默认不开始，先让玩家设置
    }

    // ================= 弹窗：设置 / 联机 / 记录 / 规则 =================
    _wireSetup() {
        const $ = id => document.getElementById(id);
        this.setupEls = {
            modal: $('setupModal'),
            local: $('modeLocalBtn'),
            online: $('modeOnlineBtn'),
            hint: $('setupModeHint'),
            startLocal: $('startLocalBtn'),
            close: $('setupCloseBtn')
        };
        if (this.setupEls.local) this.setupEls.local.addEventListener('click', () => this._setSetupMode('local'));
        if (this.setupEls.online) this.setupEls.online.addEventListener('click', () => this._setSetupMode('online'));
        if (this.setupEls.startLocal) this.setupEls.startLocal.addEventListener('click', () => this.startLocal());
        if (this.setupEls.close) this.setupEls.close.addEventListener('click', () => this.closeSetup());

        const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
        bind('setupOpenBtn', () => this.openSetup());
        bind('roomSetupBtn', () => this.openSetup());
        bind('replayOpenBtn', () => this.openReplay());
        bind('rulesOpenBtn', () => this.openRules());

        // 统一：右上角 ✕ 关闭 + 点击遮罩关闭 + ESC 关闭最上层弹窗 + 无障碍标注
        document.querySelectorAll('.modal-x').forEach(btn => {
            btn.setAttribute('aria-label', '关闭');
            btn.addEventListener('click', () => this.closeModalById(btn.dataset.close));
        });
        document.querySelectorAll('.modal-overlay').forEach(ov => {
            ov.setAttribute('role', 'dialog');
            ov.setAttribute('aria-modal', 'true');
            ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.add('hidden'); });
        });
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            const open = [...document.querySelectorAll('.modal-overlay')].filter(m => !m.classList.contains('hidden'));
            if (open.length) open[open.length - 1].classList.add('hidden');
        });
    }

    openModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('hidden'); }
    closeModalById(id) { const m = document.getElementById(id); if (m) m.classList.add('hidden'); }

    openSetup() {
        this.openModal('setupModal');
        if (window.onlineSession && window.onlineSession._syncSettingsUI) window.onlineSession._syncSettingsUI();
        const online = window.onlineSession && window.onlineSession.active;
        this._setSetupMode(online ? 'online' : this.setupMode || null);
    }
    
    /**
     * 主页面「联机对局」卡片：房间进行中或已选择联机时显示
     */
    updateOnlinePanel() {
        const p = document.getElementById('onlineInfoPanel');
        if (!p) return;
        const active = !!(window.onlineSession && window.onlineSession.active);
        p.classList.toggle('hidden', !(active || this.setupMode === 'online'));
    }
    closeSetup() { this.closeModalById('setupModal'); }
    openReplay() { this.openModal('replayModal'); }
    closeReplay() { this.closeModalById('replayModal'); }
    openRules() { this.openModal('rulesModal'); }

    _setSetupMode(mode) {
        this.setupMode = mode;
        const e = this.setupEls || {};
        const onlineSetup = document.getElementById('onlineSetup');
        if (e.local) e.local.classList.toggle('active', mode === 'local');
        if (e.online) e.online.classList.toggle('active', mode === 'online');
        if (e.startLocal) e.startLocal.classList.toggle('hidden', mode !== 'local');
        if (onlineSetup) onlineSetup.classList.toggle('hidden', mode !== 'online');
        const nameGroup = document.getElementById('nameGroup');
        if (nameGroup) nameGroup.classList.toggle('hidden', mode !== 'online');
        this.updateOnlinePanel();
        if (e.hint) {
            e.hint.textContent = mode === 'local'
                ? '本地对战：同一设备轮流操作四个颜色，点“开始本地对局”。'
                : mode === 'online'
                    ? '联机对战：创建房间，把「邀请链接」发给朋友加入。'
                    : '请选择对局方式。';
        }
    }
    async startLocal() {
        const os = window.onlineSession;
        if (os && os.active) await os.leave();
        if (os && os._readSettingsFromUI) os._readSettingsFromUI();
        this._setSetupMode('local');
        this.configured = true;
        this.gameEngine.startNewGame();
        this.closeSetup();
    }
    
    /**
     * 设置响应式布局
     */
    setupResponsiveLayout() {
        // 检测屏幕尺寸并调整布局
        this.adjustLayoutForScreen();
        
        // 监听窗口大小变化
        window.addEventListener('resize', Utils.debounce(() => {
            this.adjustLayoutForScreen();
        }, 250));
    }
    
    /**
     * 根据屏幕尺寸调整布局
     */
    adjustLayoutForScreen() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        
        // 小屏幕适配
        if (width < 768) {
            this.enableMobileLayout();
        } else {
            this.enableDesktopLayout();
        }
        
        // 调整棋盘大小
        this.adjustBoardSize();
    }
    
    /**
     * 启用移动端布局（布局由 CSS 媒体查询负责，这里不再隐藏侧栏）
     */
    enableMobileLayout() {
        // no-op：窄屏通过 CSS 让棋盘置顶、面板堆叠
    }
    
    /**
     * 启用桌面端布局
     */
    enableDesktopLayout() {
        // no-op
    }
    
    /**
     * 调整棋盘大小
     */
    adjustBoardSize() {
        // 棋盘由 BoardRenderer 监听窗口变化自行重渲；这里只同步“移动历史”高度
        const renderer = this.gameEngine && this.gameEngine.boardRenderer;
        if (renderer && renderer._syncHistoryHeight) {
            renderer._syncHistoryHeight();
        }
    }
    
    /**
     * 初始化工具提示
     */
    initializeTooltips() {
        // 为各种元素添加工具提示
        this.addTooltip('#undoBtn', '撤销上一步移动');
        this.addTooltip('#surrenderBtn', '当前玩家认输');
    }
    
    /**
     * 添加工具提示
     */
    addTooltip(selector, text) {
        const element = document.querySelector(selector);
        if (element) {
            element.title = text;
        }
    }
    
    /**
     * 更新界面
     */
    updateInterface() {
        this.adjustLayoutForScreen();
    }
}

// 导出类（如果在模块环境中）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameInterface;
}
