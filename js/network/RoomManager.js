// 房间管理类
class RoomManager {
    constructor() {
        this.currentRoom = null;
        this.playerSlots = [null, null, null, null]; // 四个玩家位置
        this.roomHost = null;
        this.gameStarted = false;
        this.roomId = null;
    }
    
    /**
     * 创建房间
     */
    createRoom(hostUser) {
        this.roomId = this.generateRoomId();
        this.roomHost = hostUser;
        this.currentRoom = {
            id: this.roomId,
            host: hostUser,
            players: {},
            playerCount: 1,
            gameState: 'waiting', // waiting, playing, finished
            createTime: new Date(),
            maxPlayers: 4
        };
        
        // 房主占据第一个位置（红方）
        this.playerSlots[0] = hostUser;
        this.currentRoom.players[hostUser.id] = {
            user: hostUser,
            position: 0,
            ready: true,
            isHost: true
        };
        
        // 保存房间信息到本地存储
        this.saveRoomToStorage();
        
        return {
            roomId: this.roomId,
            room: this.currentRoom,
            playerPosition: 0
        };
    }
    
    /**
     * 加入房间
     */
    joinRoom(roomId, user) {
        // 简化版本：从本地存储加载房间
        // 实际项目中应该从服务器获取
        const savedRoom = this.loadRoomFromStorage(roomId);
        
        if (!savedRoom) {
            throw new Error('房间不存在或已关闭');
        }
        
        if (savedRoom.playerCount >= 4) {
            throw new Error('房间已满');
        }
        
        if (savedRoom.gameState === 'playing') {
            throw new Error('游戏进行中，无法加入');
        }
        
        // 查找空位
        let position = -1;
        for (let i = 0; i < 4; i++) {
            if (!this.playerSlots[i]) {
                position = i;
                break;
            }
        }
        
        if (position === -1) {
            throw new Error('房间已满');
        }
        
        // 加入房间
        this.currentRoom = savedRoom;
        this.playerSlots[position] = user;
        this.currentRoom.players[user.id] = {
            user: user,
            position: position,
            ready: false,
            isHost: false
        };
        this.currentRoom.playerCount++;
        
        this.saveRoomToStorage();
        
        return {
            roomId: this.roomId,
            room: this.currentRoom,
            playerPosition: position
        };
    }
    
    /**
     * 离开房间
     */
    leaveRoom(userId) {
        if (!this.currentRoom) return;
        
        const player = this.currentRoom.players[userId];
        if (player) {
            // 清空玩家位置
            this.playerSlots[player.position] = null;
            delete this.currentRoom.players[userId];
            this.currentRoom.playerCount--;
            
            // 如果是房主离开，关闭房间
            if (player.isHost) {
                this.closeRoom();
            } else {
                this.saveRoomToStorage();
            }
        }
    }
    
    /**
     * 关闭房间
     */
    closeRoom() {
        if (this.roomId) {
            localStorage.removeItem(`chess_room_${this.roomId}`);
        }
        this.currentRoom = null;
        this.playerSlots = [null, null, null, null];
        this.roomHost = null;
        this.gameStarted = false;
        this.roomId = null;
    }
    
    /**
     * 设置玩家准备状态
     */
    setPlayerReady(userId, ready) {
        if (this.currentRoom && this.currentRoom.players[userId]) {
            this.currentRoom.players[userId].ready = ready;
            this.saveRoomToStorage();
            return true;
        }
        return false;
    }
    
    /**
     * 检查是否所有玩家都准备好
     */
    checkAllPlayersReady() {
        if (!this.currentRoom || this.currentRoom.playerCount < 4) {
            return false;
        }
        
        for (let playerId in this.currentRoom.players) {
            if (!this.currentRoom.players[playerId].ready) {
                return false;
            }
        }
        return true;
    }
    
    /**
     * 开始游戏
     */
    startGame() {
        if (!this.checkAllPlayersReady()) {
            throw new Error('所有玩家都需要准备好才能开始游戏');
        }
        
        this.currentRoom.gameState = 'playing';
        this.gameStarted = true;
        this.saveRoomToStorage();
        
        return true;
    }
    
    /**
     * 获取玩家在房间中的位置
     */
    getPlayerPosition(userId) {
        if (this.currentRoom && this.currentRoom.players[userId]) {
            return this.currentRoom.players[userId].position;
        }
        return -1;
    }
    
    /**
     * 获取房间信息
     */
    getRoomInfo() {
        return {
            room: this.currentRoom,
            playerSlots: this.playerSlots,
            isHost: this.roomHost && this.roomHost.id === this.getCurrentUser()?.id
        };
    }
    
    /**
     * 生成房间ID
     */
    generateRoomId() {
        return Math.random().toString(36).substr(2, 9).toUpperCase();
    }
    
    /**
     * 保存房间到本地存储
     */
    saveRoomToStorage() {
        if (this.roomId && this.currentRoom) {
            const roomData = {
                ...this.currentRoom,
                playerSlots: this.playerSlots
            };
            localStorage.setItem(`chess_room_${this.roomId}`, JSON.stringify(roomData));
            
            // 同时保存当前房间ID
            localStorage.setItem('current_room_id', this.roomId);
        }
    }
    
    /**
     * 从本地存储加载房间
     */
    loadRoomFromStorage(roomId) {
        try {
            const roomData = localStorage.getItem(`chess_room_${roomId}`);
            if (roomData) {
                const parsed = JSON.parse(roomData);
                this.playerSlots = parsed.playerSlots || [null, null, null, null];
                return parsed;
            }
        } catch (e) {
            console.error('Failed to load room from storage:', e);
        }
        return null;
    }
    
    /**
     * 恢复房间状态
     */
    restoreRoom() {
        const currentRoomId = localStorage.getItem('current_room_id');
        if (currentRoomId) {
            const roomData = this.loadRoomFromStorage(currentRoomId);
            if (roomData) {
                this.roomId = currentRoomId;
                this.currentRoom = roomData;
                return roomData;
            }
        }
        return null;
    }
    
    /**
     * 获取当前用户（需要与UserManager集成）
     */
    getCurrentUser() {
        const userData = localStorage.getItem('chess_user');
        return userData ? JSON.parse(userData) : null;
    }
}

// 导出类
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RoomManager;
}
