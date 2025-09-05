// 用户管理类
class UserManager {
    constructor() {
        this.currentUser = null;
        this.isLoggedIn = false;
    }
    
    /**
     * 用户登录（简化版本，只需要昵称）
     */
    login(nickname) {
        if (!nickname) {
            throw new Error('昵称不能为空');
        }
        
        if (nickname.length < 2 || nickname.length > 10) {
            throw new Error('昵称长度应在2-10个字符之间');
        }
        
        // 使用昵称生成唯一ID
        const userId = this.generateUserId(nickname);
        
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
     * 生成用户ID（基于昵称和时间戳）
     */
    generateUserId(nickname) {
        const timestamp = Date.now().toString(36);
        const cleanNickname = nickname.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '').slice(0, 6);
        return `${cleanNickname}_${timestamp}`;
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
