// 网络游戏控制器
class NetworkGameController {
    constructor() {
        this.userManager = new UserManager();
        this.roomManager = new RoomManager();
        this.gameEngine = null;
        this.myPlayerPosition = -1;
        this.isMyTurn = false;
        this.gameCallbacks = {};
    }
    
    /**
     * 初始化
     */
    init() {
        // 尝试自动登录
        const user = this.userManager.autoLogin();
        if (user) {
            // 尝试恢复房间状态
            this.roomManager.restoreRoom();
        }
        
        return user;
    }
    
    /**
     * 登录
     */
    login(userId, nickname) {
        const user = this.userManager.login(userId, nickname);
        this.fireCallback('onLogin', user);
        return user;
    }
    
    /**
     * 登出
     */
    logout() {
        this.leaveRoom();
        this.userManager.logout();
        this.fireCallback('onLogout');
    }
    
    /**
     * 创建房间
     */
    createRoom() {
        const user = this.userManager.getCurrentUser();
        if (!user) {
            throw new Error('请先登录');
        }
        
        const result = this.roomManager.createRoom(user);
        this.myPlayerPosition = result.playerPosition;
        
        this.fireCallback('onRoomCreated', result);
        this.fireCallback('onRoomUpdated', this.roomManager.getRoomInfo());
        
        return result;
    }
    
    /**
     * 加入房间
     */
    joinRoom(roomId) {
        const user = this.userManager.getCurrentUser();
        if (!user) {
            throw new Error('请先登录');
        }
        
        const result = this.roomManager.joinRoom(roomId, user);
        this.myPlayerPosition = result.playerPosition;
        
        this.fireCallback('onRoomJoined', result);
        this.fireCallback('onRoomUpdated', this.roomManager.getRoomInfo());
        
        return result;
    }
    
    /**
     * 离开房间
     */
    leaveRoom() {
        const user = this.userManager.getCurrentUser();
        if (user) {
            this.roomManager.leaveRoom(user.id);
            this.myPlayerPosition = -1;
            this.isMyTurn = false;
            
            this.fireCallback('onRoomLeft');
        }
    }
    
    /**
     * 设置准备状态
     */
    setReady(ready) {
        const user = this.userManager.getCurrentUser();
        if (user) {
            this.roomManager.setPlayerReady(user.id, ready);
            this.fireCallback('onRoomUpdated', this.roomManager.getRoomInfo());
            
            // 检查是否可以开始游戏
            if (this.roomManager.checkAllPlayersReady()) {
                this.fireCallback('onAllPlayersReady');
            }
        }
    }
    
    /**
     * 开始游戏
     */
    startGame() {
        try {
            this.roomManager.startGame();
            
            // 初始化游戏引擎
            this.initGameEngine();
            
            this.fireCallback('onGameStarted');
            this.updateTurnStatus();
            
            return true;
        } catch (error) {
            this.fireCallback('onError', error.message);
            return false;
        }
    }
    
    /**
     * 初始化游戏引擎
     */
    initGameEngine() {
        // 创建游戏实例，但禁用本地控制，改为网络控制
        if (this.gameEngine) {
            this.gameEngine.cleanup();
        }
        
        // 这里需要修改GameEngine以支持网络模式
        this.gameEngine = new GameEngine();
        this.gameEngine.setNetworkMode(true);
        this.gameEngine.setPlayerPosition(this.myPlayerPosition);
        
        // 监听游戏事件
        this.gameEngine.onMoveCompleted = (move) => {
            this.handleLocalMove(move);
        };
        
        this.gameEngine.onGameEnd = (result) => {
            this.fireCallback('onGameEnd', result);
        };
        
        this.gameEngine.startNewGame();
    }
    
    /**
     * 处理本地移动
     */
    handleLocalMove(move) {
        // 验证是否是当前玩家的回合
        if (!this.isMyTurn) {
            this.fireCallback('onError', '现在不是你的回合');
            return false;
        }
        
        // 广播移动到其他玩家（简化版本：保存到本地存储）
        this.broadcastMove(move);
        
        // 更新回合状态
        this.updateTurnStatus();
        
        return true;
    }
    
    /**
     * 广播移动（简化版本）
     */
    broadcastMove(move) {
        const roomId = this.roomManager.roomId;
        if (roomId) {
            const moveData = {
                ...move,
                playerId: this.userManager.getCurrentUser().id,
                timestamp: Date.now()
            };
            
            // 保存移动记录
            const moves = this.getStoredMoves();
            moves.push(moveData);
            localStorage.setItem(`chess_moves_${roomId}`, JSON.stringify(moves));
            
            this.fireCallback('onMoveCompleted', moveData);
        }
    }
    
    /**
     * 获取存储的移动记录
     */
    getStoredMoves() {
        const roomId = this.roomManager.roomId;
        if (roomId) {
            try {
                const stored = localStorage.getItem(`chess_moves_${roomId}`);
                return stored ? JSON.parse(stored) : [];
            } catch (e) {
                return [];
            }
        }
        return [];
    }
    
    /**
     * 更新回合状态
     */
    updateTurnStatus() {
        if (this.gameEngine) {
            const currentPlayer = this.gameEngine.getCurrentPlayer();
            this.isMyTurn = (currentPlayer === this.myPlayerPosition);
            
            this.fireCallback('onTurnChanged', {
                currentPlayer: currentPlayer,
                isMyTurn: this.isMyTurn
            });
        }
    }
    
    /**
     * 获取当前游戏状态
     */
    getGameState() {
        return {
            user: this.userManager.getCurrentUser(),
            room: this.roomManager.getRoomInfo(),
            myPosition: this.myPlayerPosition,
            isMyTurn: this.isMyTurn,
            gameStarted: this.roomManager.gameStarted
        };
    }
    
    /**
     * 注册回调函数
     */
    on(event, callback) {
        if (!this.gameCallbacks[event]) {
            this.gameCallbacks[event] = [];
        }
        this.gameCallbacks[event].push(callback);
    }
    
    /**
     * 触发回调
     */
    fireCallback(event, data) {
        if (this.gameCallbacks[event]) {
            this.gameCallbacks[event].forEach(callback => {
                try {
                    callback(data);
                } catch (e) {
                    console.error(`Error in ${event} callback:`, e);
                }
            });
        }
    }
    
    /**
     * 轮询更新（简化的实时同步）
     */
    startPolling() {
        if (this.pollingInterval) return;
        
        this.pollingInterval = setInterval(() => {
            this.checkForUpdates();
        }, 2000); // 每2秒检查一次更新
    }
    
    /**
     * 停止轮询
     */
    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }
    
    /**
     * 检查更新
     */
    checkForUpdates() {
        // 检查房间更新
        if (this.roomManager.roomId) {
            const updatedRoom = this.roomManager.loadRoomFromStorage(this.roomManager.roomId);
            if (updatedRoom && updatedRoom !== this.roomManager.currentRoom) {
                this.roomManager.currentRoom = updatedRoom;
                this.fireCallback('onRoomUpdated', this.roomManager.getRoomInfo());
            }
            
            // 检查新的移动
            this.checkForNewMoves();
        }
    }
    
    /**
     * 检查新的移动
     */
    checkForNewMoves() {
        const moves = this.getStoredMoves();
        const lastProcessedMove = this.lastProcessedMoveIndex || 0;
        
        if (moves.length > lastProcessedMove) {
            for (let i = lastProcessedMove; i < moves.length; i++) {
                const move = moves[i];
                if (move.playerId !== this.userManager.getCurrentUser().id) {
                    // 这是其他玩家的移动
                    this.applyRemoteMove(move);
                }
            }
            this.lastProcessedMoveIndex = moves.length;
        }
    }
    
    /**
     * 应用远程移动
     */
    applyRemoteMove(move) {
        if (this.gameEngine) {
            this.gameEngine.applyMove(move);
            this.updateTurnStatus();
            this.fireCallback('onRemoteMoveReceived', move);
        }
    }
    
    /**
     * 清理资源
     */
    cleanup() {
        this.stopPolling();
        if (this.gameEngine) {
            this.gameEngine.cleanup();
        }
    }
}

// 导出类
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NetworkGameController;
}
