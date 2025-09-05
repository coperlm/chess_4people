// 多人游戏界面管理
class MultiplayerInterface {
    constructor() {
        this.networkController = new NetworkGameController();
        this.currentView = 'login'; // login, lobby, room, game
        this.initializeInterface();
        this.bindEvents();
    }
    
    /**
     * 初始化界面
     */
    initializeInterface() {
        this.createLoginInterface();
        this.createLobbyInterface();
        this.createRoomInterface();
        
        // 等待一帧后绑定事件，确保DOM元素已经创建
        setTimeout(() => {
            this.bindEvents();
        }, 0);
        
        this.hideAllViews();
        
        // 尝试自动登录
        const user = this.networkController.init();
        if (user) {
            this.showLobby();
        } else {
            this.showLogin();
        }
        
        // 注册网络事件
        this.registerNetworkEvents();
    }
    
    /**
     * 创建登录界面
     */
    createLoginInterface() {
        const loginHTML = `
            <div id="loginView" class="fixed inset-0 bg-gray-800 bg-opacity-75 flex items-center justify-center z-50">
                <div class="bg-white rounded-lg p-8 max-w-md w-full mx-4">
                    <h2 class="text-2xl font-bold text-center mb-6">四人象棋 - 登录</h2>
                    <form id="loginForm" class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">昵称</label>
                            <input type="text" id="nickname" 
                                   class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                   placeholder="输入2-10个字符的昵称" 
                                   maxlength="10" required>
                        </div>
                        <button type="submit" 
                                class="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                            登录
                        </button>
                    </form>
                    <div id="loginError" class="mt-4 text-red-600 text-sm hidden"></div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', loginHTML);
    }
    
    /**
     * 创建大厅界面
     */
    createLobbyInterface() {
        const lobbyHTML = `
            <div id="lobbyView" class="fixed inset-0 bg-gray-800 bg-opacity-75 flex items-center justify-center z-50 hidden">
                <div class="bg-white rounded-lg p-8 max-w-2xl w-full mx-4">
                    <div class="flex justify-between items-center mb-6">
                        <h2 class="text-2xl font-bold">游戏大厅</h2>
                        <div class="flex items-center space-x-4">
                            <div id="userInfo" class="flex items-center space-x-2">
                                <span id="userNickname" class="font-medium"></span>
                            </div>
                            <button id="logoutBtn" class="text-red-600 hover:text-red-800">登出</button>
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div class="space-y-4">
                            <h3 class="text-lg font-semibold">创建房间</h3>
                            <button id="createRoomBtn" 
                                    class="w-full bg-green-600 text-white py-3 px-4 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500">
                                创建新房间
                            </button>
                        </div>
                        
                        <div class="space-y-4">
                            <h3 class="text-lg font-semibold">加入房间</h3>
                            <div class="flex space-x-2">
                                <input type="text" id="roomIdInput" 
                                       class="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                       placeholder="输入房间ID">
                                <button id="joinRoomBtn" 
                                        class="bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                                    加入
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <div id="lobbyError" class="mt-4 text-red-600 text-sm hidden"></div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', lobbyHTML);
    }
    
    /**
     * 创建房间界面
     */
    createRoomInterface() {
        const roomHTML = `
            <div id="roomView" class="fixed inset-0 bg-gray-800 bg-opacity-75 flex items-center justify-center z-50 hidden">
                <div class="bg-white rounded-lg p-8 max-w-4xl w-full mx-4">
                    <div class="flex justify-between items-center mb-6">
                        <div>
                            <h2 class="text-2xl font-bold">游戏房间</h2>
                            <p class="text-gray-600">房间ID: <span id="roomIdDisplay" class="font-mono bg-gray-100 px-2 py-1 rounded"></span></p>
                        </div>
                        <button id="leaveRoomBtn" class="text-red-600 hover:text-red-800">离开房间</button>
                    </div>
                    
                    <div class="grid grid-cols-2 gap-8 mb-6">
                        <!-- 玩家座位 -->
                        <div class="space-y-4">
                            <h3 class="text-lg font-semibold">玩家位置</h3>
                            <div class="grid grid-cols-2 gap-4">
                                <div id="playerSlot0" class="player-slot border-2 border-dashed border-gray-300 p-4 rounded-lg text-center">
                                    <div class="text-red-600 font-bold mb-2">红方</div>
                                    <div class="player-info hidden">
                                        <div class="player-name text-sm font-medium"></div>
                                        <div class="ready-status text-xs mt-1"></div>
                                    </div>
                                    <div class="empty-slot text-gray-500">等待玩家...</div>
                                </div>
                                <div id="playerSlot1" class="player-slot border-2 border-dashed border-gray-300 p-4 rounded-lg text-center">
                                    <div class="text-blue-600 font-bold mb-2">蓝方</div>
                                    <div class="player-info hidden">
                                        <div class="player-name text-sm font-medium"></div>
                                        <div class="ready-status text-xs mt-1"></div>
                                    </div>
                                    <div class="empty-slot text-gray-500">等待玩家...</div>
                                </div>
                                <div id="playerSlot2" class="player-slot border-2 border-dashed border-gray-300 p-4 rounded-lg text-center">
                                    <div class="text-green-600 font-bold mb-2">绿方</div>
                                    <div class="player-info hidden">
                                        <div class="player-name text-sm font-medium"></div>
                                        <div class="ready-status text-xs mt-1"></div>
                                    </div>
                                    <div class="empty-slot text-gray-500">等待玩家...</div>
                                </div>
                                <div id="playerSlot3" class="player-slot border-2 border-dashed border-gray-300 p-4 rounded-lg text-center">
                                    <div class="text-gray-800 font-bold mb-2">黑方</div>
                                    <div class="player-info hidden">
                                        <div class="player-name text-sm font-medium"></div>
                                        <div class="ready-status text-xs mt-1"></div>
                                    </div>
                                    <div class="empty-slot text-gray-500">等待玩家...</div>
                                </div>
                            </div>
                        </div>
                        
                        <!-- 控制面板 -->
                        <div class="space-y-4">
                            <h3 class="text-lg font-semibold">游戏控制</h3>
                            <div class="space-y-3">
                                <button id="toggleReadyBtn" 
                                        class="w-full bg-yellow-500 text-white py-2 px-4 rounded-md hover:bg-yellow-600 focus:outline-none focus:ring-2 focus:ring-yellow-500">
                                    准备
                                </button>
                                <button id="startGameBtn" 
                                        class="w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
                                        disabled>
                                    开始游戏
                                </button>
                            </div>
                            
                            <div class="bg-gray-100 p-4 rounded-lg">
                                <h4 class="font-medium mb-2">房间状态</h4>
                                <div id="roomStatus" class="text-sm text-gray-600">
                                    等待玩家加入...
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div id="roomError" class="text-red-600 text-sm hidden"></div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', roomHTML);
    }
    
    /**
     * 绑定事件
     */
    bindEvents() {
        // 登录表单
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleLogin();
            });
        }
        
        // 登出
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                this.handleLogout();
            });
        }
        
        // 创建房间
        const createRoomBtn = document.getElementById('createRoomBtn');
        if (createRoomBtn) {
            createRoomBtn.addEventListener('click', () => {
                this.handleCreateRoom();
            });
        }
        
        // 加入房间
        const joinRoomBtn = document.getElementById('joinRoomBtn');
        if (joinRoomBtn) {
            joinRoomBtn.addEventListener('click', () => {
                this.handleJoinRoom();
            });
        }
        
        // 离开房间
        const leaveRoomBtn = document.getElementById('leaveRoomBtn');
        if (leaveRoomBtn) {
            leaveRoomBtn.addEventListener('click', () => {
                this.handleLeaveRoom();
            });
        }
        
        // 准备/取消准备
        const toggleReadyBtn = document.getElementById('toggleReadyBtn');
        if (toggleReadyBtn) {
            toggleReadyBtn.addEventListener('click', () => {
                this.handleToggleReady();
            });
        }
        
        // 开始游戏
        const startGameBtn = document.getElementById('startGameBtn');
        if (startGameBtn) {
            startGameBtn.addEventListener('click', () => {
                this.handleStartGame();
            });
        }
    }
    
    /**
     * 注册网络事件
     */
    registerNetworkEvents() {
        this.networkController.on('onLogin', (user) => {
            this.updateUserInfo(user);
            this.showLobby();
        });
        
        this.networkController.on('onLogout', () => {
            this.showLogin();
        });
        
        this.networkController.on('onRoomCreated', (result) => {
            this.showRoom(result.roomId);
        });
        
        this.networkController.on('onRoomJoined', (result) => {
            this.showRoom(result.roomId);
        });
        
        this.networkController.on('onRoomLeft', () => {
            this.showLobby();
        });
        
        this.networkController.on('onRoomUpdated', (roomInfo) => {
            this.updateRoomInfo(roomInfo);
        });
        
        this.networkController.on('onGameStarted', () => {
            this.startGame();
        });
        
        this.networkController.on('onError', (message) => {
            this.showError(message);
        });
    }
    
    /**
     * 处理登录
     */
    handleLogin() {
        const nickname = document.getElementById('nickname').value.trim();
        
        try {
            this.networkController.login(nickname);
        } catch (error) {
            this.showError(error.message, 'loginError');
        }
    }
    
    /**
     * 处理登出
     */
    handleLogout() {
        this.networkController.logout();
    }
    
    /**
     * 处理创建房间
     */
    handleCreateRoom() {
        try {
            this.networkController.createRoom();
        } catch (error) {
            this.showError(error.message, 'lobbyError');
        }
    }
    
    /**
     * 处理加入房间
     */
    handleJoinRoom() {
        const roomIdInput = document.getElementById('roomIdInput');
        const roomId = roomIdInput ? roomIdInput.value.trim() : '';
        
        if (!roomId) {
            this.showError('请输入房间ID', 'lobbyError');
            return;
        }
        
        console.log('尝试加入房间:', roomId);
        
        try {
            const result = this.networkController.joinRoom(roomId);
            console.log('加入房间成功:', result);
        } catch (error) {
            console.log('加入房间失败:', error.message);
            this.showError(error.message, 'lobbyError');
        }
    }
    
    /**
     * 处理离开房间
     */
    handleLeaveRoom() {
        this.networkController.leaveRoom();
    }
    
    /**
     * 处理准备状态切换
     */
    handleToggleReady() {
        const btn = document.getElementById('toggleReadyBtn');
        const isReady = btn.textContent === '取消准备';
        this.networkController.setReady(!isReady);
        
        btn.textContent = isReady ? '准备' : '取消准备';
        btn.className = isReady 
            ? 'w-full bg-yellow-500 text-white py-2 px-4 rounded-md hover:bg-yellow-600 focus:outline-none focus:ring-2 focus:ring-yellow-500'
            : 'w-full bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500';
    }
    
    /**
     * 处理开始游戏
     */
    handleStartGame() {
        this.networkController.startGame();
    }
    
    /**
     * 显示登录界面
     */
    showLogin() {
        this.hideAllViews();
        document.getElementById('loginView').classList.remove('hidden');
        this.currentView = 'login';
    }
    
    /**
     * 显示大厅界面
     */
    showLobby() {
        this.hideAllViews();
        document.getElementById('lobbyView').classList.remove('hidden');
        this.currentView = 'lobby';
    }
    
    /**
     * 显示房间界面
     */
    showRoom(roomId) {
        this.hideAllViews();
        document.getElementById('roomView').classList.remove('hidden');
        document.getElementById('roomIdDisplay').textContent = roomId;
        this.currentView = 'room';
        
        // 开始轮询更新
        this.networkController.startPolling();
    }
    
    /**
     * 开始游戏
     */
    startGame() {
        this.hideAllViews();
        this.currentView = 'game';
        
        // 显示原始游戏界面
        document.querySelector('header').style.display = 'block';
        document.querySelector('main').style.display = 'block';
    }
    
    /**
     * 隐藏所有视图
     */
    hideAllViews() {
        document.getElementById('loginView').classList.add('hidden');
        document.getElementById('lobbyView').classList.add('hidden');
        document.getElementById('roomView').classList.add('hidden');
        
        // 隐藏原始游戏界面
        document.querySelector('header').style.display = 'none';
        document.querySelector('main').style.display = 'none';
    }
    
    /**
     * 更新用户信息显示
     */
    updateUserInfo(user) {
        const nicknameEl = document.getElementById('userNickname');
        if (nicknameEl) {
            nicknameEl.textContent = user.nickname;
        }
    }
    
    /**
     * 更新房间信息
     */
    updateRoomInfo(roomInfo) {
        const { room, playerSlots } = roomInfo;
        
        // 更新玩家位置
        for (let i = 0; i < 4; i++) {
            const slot = document.getElementById(`playerSlot${i}`);
            const player = playerSlots[i];
            
            if (player) {
                // 显示玩家信息
                slot.querySelector('.empty-slot').style.display = 'none';
                const playerInfoDiv = slot.querySelector('.player-info');
                playerInfoDiv.style.display = 'block';
                
                slot.querySelector('.player-name').textContent = player.nickname;
                
                const playerData = room.players[player.id];
                const readyStatus = slot.querySelector('.ready-status');
                if (playerData) {
                    readyStatus.textContent = playerData.ready ? '已准备' : '未准备';
                    readyStatus.className = `text-xs mt-1 ${playerData.ready ? 'text-green-600' : 'text-red-600'}`;
                }
            } else {
                // 显示空位
                slot.querySelector('.empty-slot').style.display = 'block';
                slot.querySelector('.player-info').style.display = 'none';
            }
        }
        
        // 更新开始游戏按钮状态（允许少于4人开始）
        const startBtn = document.getElementById('startGameBtn');
        if (startBtn) {
            const canStart = room.playerCount >= 1 && this.networkController.roomManager.checkAllPlayersReady();
            startBtn.disabled = !canStart;
        }
        
        // 更新房间状态
        const statusDiv = document.getElementById('roomStatus');
        if (statusDiv) {
            if (room.playerCount < 1) {
                statusDiv.textContent = '等待玩家加入';
            } else if (this.networkController.roomManager.checkAllPlayersReady()) {
                statusDiv.textContent = `可以开始游戏 (${room.playerCount}/4 人)`;
            } else {
                statusDiv.textContent = `等待所有玩家准备 (${room.playerCount}/4 人)`;
            }
        }
    }
    
    /**
     * 显示错误信息
     */
    showError(message, elementId = null) {
        const errorElements = [
            'loginError', 'lobbyError', 'roomError'
        ];
        
        // 清除所有错误信息
        errorElements.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = '';
                el.classList.add('hidden');
            }
        });
        
        // 显示指定的错误信息
        if (elementId) {
            const errorEl = document.getElementById(elementId);
            if (errorEl) {
                errorEl.textContent = message;
                errorEl.classList.remove('hidden');
            }
        } else {
            // 根据当前视图显示错误
            let targetErrorId = 'loginError';
            if (this.currentView === 'lobby') targetErrorId = 'lobbyError';
            else if (this.currentView === 'room') targetErrorId = 'roomError';
            
            const errorEl = document.getElementById(targetErrorId);
            if (errorEl) {
                errorEl.textContent = message;
                errorEl.classList.remove('hidden');
            }
        }
        
        // 3秒后自动隐藏错误信息
        setTimeout(() => {
            const errorEl = document.getElementById(elementId || 'loginError');
            if (errorEl) {
                errorEl.classList.add('hidden');
            }
        }, 3000);
    }
}

// 导出类
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MultiplayerInterface;
}
