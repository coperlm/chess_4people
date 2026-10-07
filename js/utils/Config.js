// 游戏配置文件
class Config {
    static BOARD_SIZE = 10;  // 10x10，河界为两格之间的视觉分隔线
    static PLAYABLE_SIZE = 5;
    
    // 队伍配置（对角线队友）
    static TEAMS = {
        TEAM1: [0, 1], // 红方 + 蓝方
        TEAM2: [2, 3]  // 绿方 + 黑方
    };
    
    // 对战模式
    static MODES = {
        TEAM: 'team', // 两两组队（红蓝 vs 绿黑）
        FFA: 'ffa'    // 四人混战（各自为战）
    };
    
    // 胜利条件
    static VICTORY = {
        ANY_KING: 'any_king', // 吃将任意一方即结束（默认）
        LAST_TEAM: 'last_team' // 仅剩一队/一人
    };
    
    // 默认房间规则
    static DEFAULT_RULES = { mode: 'team', victory: 'any_king', friendlyFire: false };
    
    // 回放签名用盐（写死在源码里：只防普通修改，不防专业攻击）
    static SIGN_SALT = 'chess4p::2026::lin';

    // 联机信令：Trystero nostr 策略的“公共中继冗余条数”。
    // 内置中继列表有 29 条、默认只用前 5 条；多连几条可提高“至少一条可达”的概率（信令被墙/宕时的兜底）。
    static RELAY_REDUNDANCY = 10;

    // 联机 ICE：STUN = 发现本机公网地址、尝试打洞；TURN = 打洞失败时中继转发。
    // 同一 Wi-Fi 靠 host 候选即可连通；跨网络（尤其手机运营商 CGNAT / 对称 NAT）必须靠 STUN/TURN。
    // STUN 用公共的即可；国内地址更可靠（Google 的在国内常被干扰）。
    static ICE_STUN_SERVERS = [
        { urls: 'stun:stun.qq.com:3478' },
        { urls: 'stun:stun.miwifi.com:3478' },
        { urls: 'stun:stun.chat.bilibili.com:3478' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ];

    // TURN 中继：对称 NAT / 运营商 CGNAT 下唯一可靠的兜底。
    // **不在源码里写凭据**（本仓库公开）：改为构建/部署时由 tools/inject-ice.js 生成
    // js/utils/ice-secrets.js（gitignore 掉），运行时经 window.__CHESS4P_TURN__ 合并进来。
    // 凭据来源：CI = GitHub Secret `CHESS4P_TURN_JSON`；本地 = 仓库根 Metered.txt。详见 README。
    // 这里保留为空数组，也可手动硬编码（不建议：会入库）。
    static ICE_TURN_SERVERS = [];

    /** 运行时注入的 TURN 凭据（由 tools/inject-ice.js 生成 js/utils/ice-secrets.js；仓库里不含凭据） */
    static _injectedTurn() {
        return (typeof window !== 'undefined' && Array.isArray(window.__CHESS4P_TURN__)) ? window.__CHESS4P_TURN__ : [];
    }

    /** 供 Trystero rtcConfig.iceServers 使用的完整 ICE 列表（内置 STUN + 手填 TURN + 注入的 TURN）。 */
    static iceServers() {
        return [...Config.ICE_STUN_SERVERS, ...Config.ICE_TURN_SERVERS, ...Config._injectedTurn()];
    }

    /** 是否配置了 TURN（用于区分“无法直连”与“中继也不通”的提示文案）。 */
    static hasTurnServer() {
        return [...Config.ICE_TURN_SERVERS, ...Config._injectedTurn()].some(s => {
            const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
            return urls.some(u => /^turns?:/i.test(u || ''));
        });
    }
    
    // 玩家颜色配置
    static PLAYER_COLORS = {
        0: { name: '红方', color: 'text-red-600', bg: 'bg-red-100', border: 'border-red-400' },
        1: { name: '蓝方', color: 'text-blue-600', bg: 'bg-blue-100', border: 'border-blue-400' },
        2: { name: '绿方', color: 'text-green-600', bg: 'bg-green-100', border: 'border-green-400' },
        3: { name: '黑方', color: 'text-gray-800', bg: 'bg-gray-100', border: 'border-gray-400' }
    };
    
    // 棋子类型
    static PIECE_TYPES = {
        KING: 'king',     // 帅/将
        ADVISOR: 'advisor', // 士/仕
        ELEPHANT: 'elephant', // 相/象
        HORSE: 'horse',   // 马
        ROOK: 'rook',     // 车
        CANNON: 'cannon', // 炮
        PAWN: 'pawn'      // 兵/卒
    };
    
    // 棋子中文名称（命名分两套，同队一致）
    // 帅/士/相/兵：红方(0) + 蓝方(1)；将/仕/象/卒：绿方(2) + 黑方(3)
    static PIECE_NAMES = {
        0: { // 红方
            king: '帅', advisor: '士', elephant: '相',
            horse: '马', rook: '车', cannon: '炮', pawn: '兵'
        },
        1: { // 蓝方
            king: '帅', advisor: '士', elephant: '相',
            horse: '马', rook: '车', cannon: '炮', pawn: '兵'
        },
        2: { // 绿方
            king: '将', advisor: '仕', elephant: '象',
            horse: '马', rook: '车', cannon: '炮', pawn: '卒'
        },
        3: { // 黑方
            king: '将', advisor: '仕', elephant: '象',
            horse: '马', rook: '车', cannon: '炮', pawn: '卒'
        }
    };
    
    // 可落子区域定义（10x10棋盘，坐标0-9）
    static PLAYABLE_AREAS = {
        0: { x: [0, 4], y: [5, 9] }, // 红方：左下
        1: { x: [5, 9], y: [0, 4] }, // 蓝方：右上
        2: { x: [5, 9], y: [5, 9] }, // 绿方：右下
        3: { x: [0, 4], y: [0, 4] }  // 黑方：左上
    };
    
    // 九宫格区域定义（10x10棋盘，坐标0-9）
    static PALACE_AREAS = {
        0: { x: [0, 2], y: [7, 9] },  // 红方九宫格
        1: { x: [7, 9], y: [0, 2] },  // 蓝方九宫格
        2: { x: [7, 9], y: [7, 9] },  // 绿方九宫格
        3: { x: [0, 2], y: [0, 2] }   // 黑方九宫格
    };
    
    // 兵/卒固定朝向：由初始格决定，指向最近的相邻敌人（4 兵 = 2 管一个邻敌 + 2 管另一个）
    // 未过河只能沿 facing 前进一格；过河后可前进 + 两侧垂直方向，永不后退
    // 初始棋子位置（基于旋转对称）
    static INITIAL_POSITIONS = {
        3: [ // 黑方 - 左上角（邻敌：红方↓、蓝方→）
            { type: 'king', x: 0, y: 0 },
            { type: 'advisor', x: 1, y: 1 },
            { type: 'elephant', x: 0, y: 2 },
            { type: 'rook', x: 1, y: 0 },
            { type: 'horse', x: 2, y: 2 },
            { type: 'cannon', x: 1, y: 2 },
            { type: 'pawn', x: 0, y: 3, facing: 'down' },
            { type: 'pawn', x: 2, y: 3, facing: 'down' },
            { type: 'pawn', x: 3, y: 0, facing: 'right' },
            { type: 'pawn', x: 3, y: 2, facing: 'right' }
        ],
        1: [ // 蓝方 - 右上角 (顺时针旋转90度)（邻敌：黑方←、绿方↓）
            { type: 'king', x: 9, y: 0 },
            { type: 'advisor', x: 8, y: 1 },
            { type: 'elephant', x: 7, y: 0 },
            { type: 'rook', x: 9, y: 1 },
            { type: 'horse', x: 7, y: 2 },
            { type: 'cannon', x: 7, y: 1 },
            { type: 'pawn', x: 6, y: 0, facing: 'left' },
            { type: 'pawn', x: 6, y: 2, facing: 'left' },
            { type: 'pawn', x: 9, y: 3, facing: 'down' },
            { type: 'pawn', x: 7, y: 3, facing: 'down' }
        ],
        2: [ // 绿方 - 右下角 (旋转180度)（邻敌：蓝方↑、红方←）
            { type: 'king', x: 9, y: 9 },
            { type: 'advisor', x: 8, y: 8 },
            { type: 'elephant', x: 9, y: 7 },
            { type: 'rook', x: 8, y: 9 },
            { type: 'horse', x: 7, y: 7 },
            { type: 'cannon', x: 8, y: 7 },
            { type: 'pawn', x: 9, y: 6, facing: 'up' },
            { type: 'pawn', x: 7, y: 6, facing: 'up' },
            { type: 'pawn', x: 6, y: 9, facing: 'left' },
            { type: 'pawn', x: 6, y: 7, facing: 'left' }
        ],
        0: [ // 红方 - 左下角 (逆时针旋转90度)（邻敌：黑方↑、绿方→）
            { type: 'king', x: 0, y: 9 },
            { type: 'advisor', x: 1, y: 8 },
            { type: 'elephant', x: 2, y: 9 },
            { type: 'rook', x: 0, y: 8 },
            { type: 'horse', x: 2, y: 7 },
            { type: 'cannon', x: 2, y: 8 },
            { type: 'pawn', x: 3, y: 9, facing: 'right' },
            { type: 'pawn', x: 3, y: 7, facing: 'right' },
            { type: 'pawn', x: 0, y: 6, facing: 'up' },
            { type: 'pawn', x: 2, y: 6, facing: 'up' }
        ]
    };
}

// 导出配置（如果在模块环境中）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Config;
}
