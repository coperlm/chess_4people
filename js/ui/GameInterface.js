// 游戏界面管理器
class GameInterface {
    constructor(gameEngine) {
        this.gameEngine = gameEngine;
        this.gameEngine.gameInterface = this;
        
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
        const boardContainer = document.querySelector('.lg\\:w-2\\/4');
        const board = document.getElementById('chessBoard');
        
        if (board && boardContainer) {
            const containerWidth = boardContainer.clientWidth;
            const maxSize = Math.min(containerWidth - 40, window.innerHeight - 200);
            
            board.style.maxWidth = `${maxSize}px`;
            board.style.maxHeight = `${maxSize}px`;
        }
    }
    
    /**
     * 绑定界面事件
     */
    bindInterfaceEvents() {
        // 绑定设置按钮
        this.bindSettingsEvents();
        
        // 绑定主题切换
        this.bindThemeEvents();
        
        // 绑定帮助按钮
        this.bindHelpEvents();
        
        // 绑定音效控制
        this.bindSoundEvents();
    }
    
    /**
     * 绑定设置相关事件
     */
    bindSettingsEvents() {
        // 创建设置按钮（如果不存在）
        this.createSettingsButton();
    }
    
    /**
     * 创建设置按钮
     */
    createSettingsButton() {
        const controlPanel = document.querySelector('.space-y-2');
        if (!controlPanel) return;
        
        // 检查是否已经存在
        if (document.getElementById('settingsBtn')) return;
        
        const settingsBtn = document.createElement('button');
        settingsBtn.id = 'settingsBtn';
        settingsBtn.className = 'w-full bg-gray-500 text-white py-2 px-4 rounded hover:bg-gray-600 transition-colors';
        settingsBtn.textContent = '游戏设置';
        
        settingsBtn.addEventListener('click', () => {
            this.showSettingsModal();
        });
        
        controlPanel.appendChild(settingsBtn);
    }
    
    /**
     * 显示设置模态框
     */
    showSettingsModal() {
        // 创建设置模态框
        const modal = this.createModal('游戏设置', this.createSettingsContent());
        document.body.appendChild(modal);
        
        // 显示模态框
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            modal.classList.add('opacity-100');
        }, 10);
    }
    
    /**
     * 创建设置内容
     */
    createSettingsContent() {
        const content = document.createElement('div');
        content.className = 'space-y-4';
        
        content.innerHTML = `
            <div>
                <label class="flex items-center space-x-2">
                    <input type="checkbox" id="enableSound" ${this.getSetting('enableSound', true) ? 'checked' : ''}>
                    <span>启用音效</span>
                </label>
            </div>
            
            <div>
                <label class="flex items-center space-x-2">
                    <input type="checkbox" id="showCoordinates" ${this.getSetting('showCoordinates', false) ? 'checked' : ''}>
                    <span>显示坐标</span>
                </label>
            </div>
            
            <div>
                <label class="flex items-center space-x-2">
                    <input type="checkbox" id="highlightMoves" ${this.getSetting('highlightMoves', true) ? 'checked' : ''}>
                    <span>高亮可移动位置</span>
                </label>
            </div>
            
            <div>
                <label class="flex items-center space-x-2">
                    <input type="checkbox" id="autoSave" ${this.getSetting('autoSave', true) ? 'checked' : ''}>
                    <span>自动保存游戏</span>
                </label>
            </div>
            
            <div class="pt-4 border-t">
                <button id="resetSettings" class="w-full bg-red-500 text-white py-2 px-4 rounded hover:bg-red-600 transition-colors">
                    重置所有设置
                </button>
            </div>
        `;
        
        // 绑定设置事件
        this.bindSettingsModalEvents(content);
        
        return content;
    }
    
    /**
     * 绑定设置模态框事件
     */
    bindSettingsModalEvents(content) {
        // 音效设置
        const enableSound = content.querySelector('#enableSound');
        if (enableSound) {
            enableSound.addEventListener('change', (e) => {
                this.saveSetting('enableSound', e.target.checked);
            });
        }
        
        // 坐标显示设置
        const showCoordinates = content.querySelector('#showCoordinates');
        if (showCoordinates) {
            showCoordinates.addEventListener('change', (e) => {
                this.saveSetting('showCoordinates', e.target.checked);
                this.toggleCoordinates(e.target.checked);
            });
        }
        
        // 移动高亮设置
        const highlightMoves = content.querySelector('#highlightMoves');
        if (highlightMoves) {
            highlightMoves.addEventListener('change', (e) => {
                this.saveSetting('highlightMoves', e.target.checked);
            });
        }
        
        // 自动保存设置
        const autoSave = content.querySelector('#autoSave');
        if (autoSave) {
            autoSave.addEventListener('change', (e) => {
                this.saveSetting('autoSave', e.target.checked);
            });
        }
        
        // 重置设置
        const resetSettings = content.querySelector('#resetSettings');
        if (resetSettings) {
            resetSettings.addEventListener('click', () => {
                if (confirm('确定要重置所有设置吗？')) {
                    this.resetAllSettings();
                    this.closeModal();
                    Utils.showMessage('设置已重置', 'success');
                }
            });
        }
    }
    
    /**
     * 创建模态框
     */
    createModal(title, content) {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 opacity-0 transition-opacity duration-300';
        
        const dialog = document.createElement('div');
        dialog.className = 'bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-96 overflow-y-auto';
        
        dialog.innerHTML = `
            <div class="px-6 py-4 border-b border-gray-200">
                <div class="flex items-center justify-between">
                    <h3 class="text-lg font-semibold text-gray-900">${title}</h3>
                    <button class="text-gray-400 hover:text-gray-600 close-modal">
                        <span class="text-2xl">&times;</span>
                    </button>
                </div>
            </div>
            
            <div class="px-6 py-4">
            </div>
            
            <div class="px-6 py-4 border-t border-gray-200 flex justify-end space-x-2">
                <button class="px-4 py-2 text-gray-600 hover:text-gray-800 close-modal">取消</button>
                <button class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 save-modal">保存</button>
            </div>
        `;
        
        // 添加内容
        const contentContainer = dialog.querySelector('.px-6.py-4:not(.border-t):not(.border-b)');
        contentContainer.appendChild(content);
        
        modal.appendChild(dialog);
        
        // 绑定关闭事件
        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.classList.contains('close-modal')) {
                this.closeModal(modal);
            }
        });
        
        // 绑定保存事件
        const saveBtn = dialog.querySelector('.save-modal');
        saveBtn.addEventListener('click', () => {
            this.closeModal(modal);
            Utils.showMessage('设置已保存', 'success');
        });
        
        return modal;
    }
    
    /**
     * 关闭模态框
     */
    closeModal(modal = null) {
        const modalToClose = modal || document.querySelector('.fixed.inset-0.bg-black');
        if (modalToClose) {
            modalToClose.classList.remove('opacity-100');
            modalToClose.classList.add('opacity-0');
            
            setTimeout(() => {
                modalToClose.remove();
            }, 300);
        }
    }
    
    /**
     * 绑定主题事件
     */
    bindThemeEvents() {
        // 主题切换功能暂时不实现
    }
    
    /**
     * 绑定帮助事件
     */
    bindHelpEvents() {
        // 创建帮助按钮
        this.createHelpButton();
    }
    
    /**
     * 创建帮助按钮
     */
    createHelpButton() {
        const rulesPanel = document.querySelector('.bg-white.rounded-lg.shadow-lg.p-6.mt-6:last-child');
        if (!rulesPanel) return;
        
        const helpBtn = document.createElement('button');
        helpBtn.className = 'mt-4 w-full bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600 transition-colors text-sm';
        helpBtn.textContent = '详细帮助';
        
        helpBtn.addEventListener('click', () => {
            this.showHelpModal();
        });
        
        rulesPanel.appendChild(helpBtn);
    }
    
    /**
     * 显示帮助模态框
     */
    showHelpModal() {
        const helpContent = this.createHelpContent();
        const modal = this.createModal('游戏帮助', helpContent);
        document.body.appendChild(modal);
        
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            modal.classList.add('opacity-100');
        }, 10);
    }
    
    /**
     * 创建帮助内容
     */
    createHelpContent() {
        const content = document.createElement('div');
        content.className = 'space-y-4 text-sm';
        
        content.innerHTML = `
            <div>
                <h4 class="font-semibold text-gray-800 mb-2">基础规则</h4>
                <ul class="space-y-1 text-gray-600">
                    <li>• 四人对战，对角线玩家为队友</li>
                    <li>• 红方和蓝方为一队，绿方和黑方为一队</li>
                    <li>• 河界位置不可落子，棋子需跨越河界移动</li>
                    <li>• 将死任意敌方玩家即可获胜</li>
                </ul>
            </div>
            
            <div>
                <h4 class="font-semibold text-gray-800 mb-2">棋子移动</h4>
                <ul class="space-y-1 text-gray-600">
                    <li>• 将/帅：九宫格内直线移动一格</li>
                    <li>• 士/仕：九宫格内斜向移动一格</li>
                    <li>• 相/象：本方区域内走田字，不可过河</li>
                    <li>• 马：走日字，马腿不能被阻挡</li>
                    <li>• 车：直线移动，路径不能有阻挡</li>
                    <li>• 炮：移动时直线无阻挡，攻击时需隔一子</li>
                    <li>• 兵/卒：有方向性，过河前只能直进，过河后可横移</li>
                </ul>
            </div>
            
            <div>
                <h4 class="font-semibold text-gray-800 mb-2">操作说明</h4>
                <ul class="space-y-1 text-gray-600">
                    <li>• 点击棋子选择，再点击目标位置移动</li>
                    <li>• ESC键取消选择</li>
                    <li>• Ctrl+Z悔棋</li>
                    <li>• Ctrl+N开始新游戏</li>
                </ul>
            </div>
            
            <div>
                <h4 class="font-semibold text-gray-800 mb-2">特殊规则</h4>
                <ul class="space-y-1 text-gray-600">
                    <li>• 兵：红方和蓝方，纵向移动</li>
                    <li>• 卒：绿方和黑方，横向移动</li>
                    <li>• 不能攻击队友的棋子</li>
                    <li>• 移动后不能让自己的将/帅处于被攻击状态</li>
                </ul>
            </div>
        `;
        
        return content;
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
     * 切换坐标显示
     */
    toggleCoordinates(show) {
        const cells = document.querySelectorAll('.chess-cell');
        
        cells.forEach(cell => {
            let coordinate = cell.querySelector('.coordinate');
            
            if (show) {
                if (!coordinate) {
                    coordinate = document.createElement('span');
                    coordinate.className = 'coordinate absolute top-0 left-0 text-xs text-gray-400 pointer-events-none';
                    coordinate.textContent = `${cell.dataset.x},${cell.dataset.y}`;
                    cell.appendChild(coordinate);
                }
            } else {
                if (coordinate) {
                    coordinate.remove();
                }
            }
        });
    }
    
    /**
     * 获取设置
     */
    getSetting(key, defaultValue) {
        try {
            const settings = JSON.parse(localStorage.getItem('fourPlayerChess_settings') || '{}');
            return settings[key] !== undefined ? settings[key] : defaultValue;
        } catch {
            return defaultValue;
        }
    }
    
    /**
     * 保存设置
     */
    saveSetting(key, value) {
        try {
            const settings = JSON.parse(localStorage.getItem('fourPlayerChess_settings') || '{}');
            settings[key] = value;
            localStorage.setItem('fourPlayerChess_settings', JSON.stringify(settings));
        } catch (error) {
            console.warn('保存设置失败:', error);
        }
    }
    
    /**
     * 重置所有设置
     */
    resetAllSettings() {
        try {
            localStorage.removeItem('fourPlayerChess_settings');
            
            // 重新应用默认设置
            this.toggleCoordinates(false);
        } catch (error) {
            console.warn('重置设置失败:', error);
        }
    }
    
    /**
     * 更新界面
     */
    updateInterface() {
        // 应用保存的设置
        const showCoordinates = this.getSetting('showCoordinates', false);
        this.toggleCoordinates(showCoordinates);
        
        // 更新其他界面元素
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
