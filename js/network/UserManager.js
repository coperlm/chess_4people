// 用户管理类
class UserManager {
    constructor() {
        this.currentUser = null;
        this.isLoggedIn = false;
    }
    
    /**
     * 用户登录
     */
    login(userId, nickname) {
        if (!userId || !nickname) {
            throw new Error('用户ID和昵称不能为空');
        }
        
        // 检查ID格式（简单验证）
        if (userId.length < 3 || userId.length > 20) {
            throw new Error('用户ID长度应在3-20个字符之间');
        }
        
        if (nickname.length < 2 || nickname.length > 10) {
            throw new Error('昵称长度应在2-10个字符之间');
        }
        
        this.currentUser = {
            id: userId,
            nickname: nickname,
            loginTime: new Date()
        };
        
        this.isLoggedIn = true;
        
        // 保存到本地存储
        localStorage.setItem('chess_user', JSON.stringify(this.currentUser));
        
        return this.currentUser;
    }
    
    /**
     * 用户登出
     */
    logout() {
        this.currentUser = null;
        this.isLoggedIn = false;
        localStorage.removeItem('chess_user');
    }
    
    /**
     * 自动登录（从本地存储恢复）
     */
    autoLogin() {
        const savedUser = localStorage.getItem('chess_user');
        if (savedUser) {
            try {
                this.currentUser = JSON.parse(savedUser);
                this.isLoggedIn = true;
                return this.currentUser;
            } catch (e) {
                localStorage.removeItem('chess_user');
            }
        }
        return null;
    }
    
    /**
     * 获取当前用户信息
     */
    getCurrentUser() {
        return this.currentUser;
    }
    
    /**
     * 检查是否已登录
     */
    checkLoginStatus() {
        return this.isLoggedIn && this.currentUser;
    }
    
    /**
     * 验证昵称是否有效
     */
    validateNickname(nickname) {
        return nickname && nickname.trim().length >= 2 && nickname.trim().length <= 10;
    }
}

// 导出类
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UserManager;
}
