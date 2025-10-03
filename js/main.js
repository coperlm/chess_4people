// 主程序入口
class ChessGameApp {
    constructor() {
        this.gameEngine = null;
        this.gameInterface = null;
        this.isInitialized = false;
        
        // 绑定错误处理
        this.bindErrorHandlers();
        
        // 等待DOM加载完成
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.initialize());
        } else {
            this.initialize();
        }
    }
    
    /**
     * 初始化应用
     */
    async initialize() {
        try {
            console.log('🎮 四人象棋游戏初始化开始...');
            
            // 显示加载状态
            this.showInitialLoading();
            
            // 检查浏览器兼容性
            if (!this.checkCompatibility()) {
                throw new Error('浏览器不兼容');
            }
            
            // 初始化游戏引擎（单机模式）
            this.gameEngine = new GameEngine();
            console.log('✅ 游戏引擎初始化完成');
            
            // 初始化游戏界面
            this.gameInterface = new GameInterface(this.gameEngine);
            console.log('✅ 游戏界面初始化完成');
            
            // 暴露到全局作用域（用于调试）
            window.gameEngine = this.gameEngine;
            window.gameInterface = this.gameInterface;
            window.chessApp = this;
            
            // 隐藏加载状态
            this.hideInitialLoading();
            
            // 标记为已初始化
            this.isInitialized = true;
            
            // 显示欢迎消息
            setTimeout(() => {
                Utils.showMessage('🎉 四人象棋游戏加载完成！点击"新游戏"开始', 'success');
            }, 500);
            
            console.log('🎯 四人象棋游戏初始化完成！');
            
            // 如果有自动保存的游戏，询问是否继续
            this.checkAutoSavedGame();
            
        } catch (error) {
            console.error('❌ 游戏初始化失败:', error);
            this.handleInitializationError(error);
        }
    }
    
    /**
     * 检查浏览器兼容性
     */
    checkCompatibility() {
        // 检查必需的JavaScript特性
        const requiredFeatures = [
            'localStorage' in window,
            'JSON' in window,
            'querySelector' in document,
            'addEventListener' in document,
            'classList' in document.createElement('div')
        ];
        
        const isCompatible = requiredFeatures.every(feature => feature);
        
        if (!isCompatible) {
            alert('您的浏览器版本过低，请使用现代浏览器访问此游戏。\n推荐使用Chrome、Firefox、Safari或Edge浏览器。');
            return false;
        }
        
        return true;
    }
    
    /**
     * 显示初始加载状态
     */
    showInitialLoading() {
        // 创建加载遮罩
        const loader = document.createElement('div');
        loader.id = 'initialLoader';
        loader.className = 'fixed inset-0 bg-gradient-to-br from-amber-50 to-amber-100 flex items-center justify-center z-50';
        
        loader.innerHTML = `
            <div class="text-center">
                <div class="mb-6">
                    <h1 class="text-4xl font-bold text-amber-800 mb-2">四人象棋</h1>
                    <p class="text-amber-600">正在加载游戏...</p>
                </div>
                
                <div class="flex justify-center mb-6">
                    <div class="animate-spin rounded-full h-12 w-12 border-4 border-amber-300 border-t-amber-600"></div>
                </div>
                
                <div class="max-w-md mx-auto">
                    <div class="bg-white bg-opacity-50 rounded-lg p-4">
                        <div class="text-sm text-amber-700 space-y-1">
                            <div class="flex items-center">
                                <div class="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                                <span>加载游戏引擎...</span>
                            </div>
                            <div class="flex items-center">
                                <div class="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                                <span>初始化棋盘...</span>
                            </div>
                            <div class="flex items-center">
                                <div class="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                                <span>准备游戏界面...</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(loader);
    }
    
    /**
     * 隐藏初始加载状态
     */
    hideInitialLoading() {
        const loader = document.getElementById('initialLoader');
        if (loader) {
            loader.style.opacity = '0';
            loader.style.transition = 'opacity 0.5s';
            
            setTimeout(() => {
                loader.remove();
            }, 500);
        }
    }
    
    /**
     * 处理初始化错误
     */
    handleInitializationError(error) {
        this.hideInitialLoading();
        
        // 显示错误信息
        const errorContainer = document.createElement('div');
        errorContainer.className = 'fixed inset-0 bg-red-50 flex items-center justify-center p-4';
        
        errorContainer.innerHTML = `
            <div class="bg-white rounded-lg shadow-lg p-6 max-w-md text-center">
                <div class="text-red-600 text-6xl mb-4">⚠️</div>
                <h2 class="text-xl font-bold text-red-800 mb-2">游戏加载失败</h2>
                <p class="text-red-600 mb-4">抱歉，游戏无法正常启动。</p>
                <p class="text-sm text-gray-600 mb-4">错误信息：${error.message}</p>
                <button onclick="location.reload()" class="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600 transition-colors">
                    重新加载页面
                </button>
            </div>
        `;
        
        document.body.appendChild(errorContainer);
    }
    
    /**
     * 绑定错误处理
     */
    bindErrorHandlers() {
        // 全局错误处理
        window.addEventListener('error', (event) => {
            console.error('全局JavaScript错误:', event.error);
            console.error('错误详情:', {
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                stack: event.error?.stack
            });
            
            if (!this.isInitialized) {
                this.handleInitializationError(event.error);
            } else {
                // 显示详细的错误信息
                const errorMsg = event.error?.message || event.message || '未知错误';
                const filename = event.filename ? event.filename.split('/').pop() : '未知文件';
                const location = event.lineno ? `行${event.lineno}` : '';
                
                const detailedMessage = `JavaScript错误: ${errorMsg}\n文件: ${filename} ${location}\n请检查控制台查看详细信息`;
                Utils.showMessage(detailedMessage, 'error');
                
                // 如果是开发环境，显示更详细的错误
                if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                    console.log('🔧 开发模式 - 详细错误信息:');
                    console.log('Stack trace:', event.error?.stack);
                }
            }
        });
        
        // Promise rejection 处理
        window.addEventListener('unhandledrejection', (event) => {
            console.error('未处理的Promise rejection:', event.reason);
            
            // 显示详细的Promise错误信息
            const reason = event.reason;
            let errorMsg = '异步错误';
            
            if (reason instanceof Error) {
                errorMsg = `Promise错误: ${reason.message}`;
                console.error('Promise错误堆栈:', reason.stack);
            } else if (typeof reason === 'string') {
                errorMsg = `Promise错误: ${reason}`;
            } else {
                errorMsg = `Promise错误: ${JSON.stringify(reason)}`;
            }
            
            Utils.showMessage(errorMsg + '\n请检查控制台查看详细信息', 'error');
        });
    }
    
    /**
     * 检查自动保存的游戏
     */
    checkAutoSavedGame() {
        try {
            const savedGame = localStorage.getItem('fourPlayerChess_autoSave');
            if (savedGame) {
                const gameData = JSON.parse(savedGame);
                const saveTime = new Date(gameData.timestamp);
                const now = new Date();
                
                // 如果保存时间在24小时内，询问是否继续
                if (now - saveTime < 24 * 60 * 60 * 1000) {
                    const shouldContinue = confirm(
                        `发现自动保存的游戏（${saveTime.toLocaleString()}）\n是否继续之前的游戏？`
                    );
                    
                    if (shouldContinue) {
                        this.loadAutoSavedGame(gameData);
                    }
                }
            }
        } catch (error) {
            console.warn('检查自动保存失败:', error);
        }
    }
    
    /**
     * 加载自动保存的游戏
     */
    loadAutoSavedGame(gameData) {
        try {
            // 这里需要实现游戏状态的恢复逻辑
            // 暂时显示消息
            Utils.showMessage('自动保存功能暂未完全实现', 'warning');
            
            console.log('发现自动保存的游戏数据:', gameData);
        } catch (error) {
            console.error('加载自动保存失败:', error);
            Utils.showMessage('无法加载之前的游戏', 'error');
        }
    }
    
    /**
     * 获取应用信息
     */
    getAppInfo() {
        return {
            name: '四人象棋',
            version: '1.0.0',
            initialized: this.isInitialized,
            gameEngine: this.gameEngine ? this.gameEngine.getGameInfo() : null,
            timestamp: Date.now()
        };
    }
    
    /**
     * 重启应用
     */
    restart() {
        if (confirm('确定要重启游戏吗？这将清除当前进度。')) {
            location.reload();
        }
    }
    
    /**
     * 显示应用信息
     */
    showAppInfo() {
        const info = this.getAppInfo();
        console.table(info);
        
        Utils.showMessage(`${info.name} v${info.version} - 运行正常`, 'info');
    }
}

// 创建并启动应用
console.log('🚀 启动四人象棋游戏...');
const chessApp = new ChessGameApp();

// 开发环境下的调试工具
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    console.log('🔧 开发模式已启用');
    
    // 添加调试快捷键
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey) {
            switch (e.key) {
                case 'I':
                    e.preventDefault();
                    chessApp.showAppInfo();
                    break;
                case 'R':
                    e.preventDefault();
                    chessApp.restart();
                    break;
                case 'D':
                    e.preventDefault();
                    console.log('当前游戏状态:', window.gameEngine ? window.gameEngine.gameState : '未初始化');
                    break;
            }
        }
    });
    
    // 添加开发者工具提示
    console.log(`
    🛠️  开发者快捷键：
    Ctrl+Shift+I - 显示应用信息
    Ctrl+Shift+R - 重启应用
    Ctrl+Shift+D - 显示游戏状态
    Ctrl+Z - 悔棋
    Ctrl+N - 新游戏
    ESC - 取消选择
    `);
}
