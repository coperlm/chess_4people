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
        this.bindInterfaceEvents();
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
        bind('replayOpenBtn', () => this.openReplay());
        bind('rulesOpenBtn', () => this.openRules());
        bind('openRulesBtn', () => this.openRules());

        // 统一：右上角 ✕ 关闭 + 点击遮罩关闭
        document.querySelectorAll('.modal-x').forEach(btn => {
            btn.addEventListener('click', () => this.closeModalById(btn.dataset.close));
        });
        document.querySelectorAll('.modal-overlay').forEach(ov => {
            ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.add('hidden'); });
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
    closeSetup() { this.closeModalById('setupModal'); }
    openReplay() { this.openModal('replayModal'); }
    closeReplay() { this.closeModalById('replayModal'); }
    openRules() { this.openModal('rulesModal'); }
    closeRules() { this.closeModalById('rulesModal'); }

    _setSetupMode(mode) {
        this.setupMode = mode;
        const e = this.setupEls || {};
        const onlineSetup = document.getElementById('onlineSetup');
        if (e.local) e.local.classList.toggle('active', mode === 'local');
        if (e.online) e.online.classList.toggle('active', mode === 'online');
        if (e.startLocal) e.startLocal.classList.toggle('hidden', mode !== 'local');
        if (onlineSetup) onlineSetup.classList.toggle('hidden', mode !== 'online');
        if (e.hint) {
            e.hint.textContent = mode === 'local'
                ? '本地对战：同一设备轮流操作四个颜色，点“开始本地对局”。'
                : mode === 'online'
                    ? '联机对战：创建或加入房间，房主点“开始 / 重开对局”。'
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
     * 启用移动端布局
     */
    enableMobileLayout() {
        const mainContainer = document.querySelector('main .flex');
        if (mainContainer) {
            mainContainer.className = mainContainer.className.replace('lg:flex-row', 'flex-col');
        }
        
        // 隐藏或简化一些界面元素
        const rightPanel = document.querySelector('main .lg\\:w-1\\/4:last-child');
        if (rightPanel) {
            rightPanel.classList.add('hidden', 'lg:block');
        }
    }
    
    /**
     * 启用桌面端布局
     */
    enableDesktopLayout() {
        const mainContainer = document.querySelector('main .flex');
        if (mainContainer) {
            mainContainer.className = mainContainer.className.replace('flex-col', 'lg:flex-row');
        }
        
        // 显示所有界面元素
        const rightPanel = document.querySelector('main .lg\\:w-1\\/4:last-child');
        if (rightPanel) {
            rightPanel.classList.remove('hidden');
        }
    }
    
    /**
     * 调整棋盘大小
     */
    adjustBoardSize() {
        // 棋盘尺寸由 BoardRenderer 按屏幕/所在栏宽度统一计算。
        // 不再用 maxWidth 裁剪容器：那会把底板压小、而网格仍是固定像素，导致“棋子超出底板”。
        const renderer = this.gameEngine && this.gameEngine.boardRenderer;
        if (renderer && typeof renderer.initializeBoard === 'function') {
            renderer.initializeBoard();
        }
    }
    
    /**
     * 绑定界面事件（入口按钮在弹窗 wiring 中绑定）
     */
    bindInterfaceEvents() {
        this.bindThemeEvents();
        this.bindSoundEvents();
    }
    
    /**
     * 绑定主题事件
     */
    bindThemeEvents() {
        // 主题切换功能暂时不实现
    }
    
    /**
     * 绑定音效事件
     */
    bindSoundEvents() {
        // 音效功能暂时不实现具体逻辑
    }
    
    /**
     * 初始化工具提示
     */
    initializeTooltips() {
        // 为各种元素添加工具提示
        this.addTooltip('#newGameBtn', '开始新的四人象棋游戏');
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
    
    /**
     * 显示加载状态
     */
    showLoading(message = '加载中...') {
        // 创建加载遮罩
        const loader = document.createElement('div');
        loader.id = 'loadingOverlay';
        loader.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        loader.innerHTML = `
            <div class="bg-white rounded-lg p-6 text-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
                <p class="text-gray-600">${message}</p>
            </div>
        `;
        
        document.body.appendChild(loader);
    }
    
    /**
     * 隐藏加载状态
     */
    hideLoading() {
        const loader = document.getElementById('loadingOverlay');
        if (loader) {
            loader.remove();
        }
    }
}

// 导出类（如果在模块环境中）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameInterface;
}
