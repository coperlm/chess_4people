// 游戏配置文件
class Config {
    static BOARD_SIZE = 11;
    static PLAYABLE_SIZE = 5;
    static RIVER_POSITION = 5;
    
    // 玩家配置
    static PLAYERS = {
        RED: 0,    // 红方 - 左下角
        BLUE: 1,   // 蓝方 - 右上角  
        GREEN: 2,  // 绿方 - 右下角
        BLACK: 3   // 黑方 - 左上角
    };
    
    // 队伍配置（对角线队友）
    static TEAMS = {
        TEAM1: [0, 1], // 红方 + 蓝方
        TEAM2: [2, 3]  // 绿方 + 黑方
    };
    
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
    
    // 棋子中文名称
    static PIECE_NAMES = {
        0: { // 红方
            king: '帅', advisor: '士', elephant: '相',
            horse: '马', rook: '车', cannon: '炮', pawn: '兵'
        },
        1: { // 蓝方
            king: '将', advisor: '仕', elephant: '象',
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
    
    // 可落子区域定义
    static PLAYABLE_AREAS = {
        0: { x: [0, 4], y: [6, 10] }, // 红方：左下
        1: { x: [6, 10], y: [0, 4] }, // 蓝方：右上
        2: { x: [6, 10], y: [6, 10] }, // 绿方：右下
        3: { x: [0, 4], y: [0, 4] }   // 黑方：左上
    };
    
    // 九宫格区域定义
    static PALACE_AREAS = {
        0: { x: [0, 2], y: [8, 10] }, // 红方九宫格
        1: { x: [8, 10], y: [0, 2] }, // 蓝方九宫格
        2: { x: [8, 10], y: [8, 10] }, // 绿方九宫格
        3: { x: [0, 2], y: [0, 2] }   // 黑方九宫格
    };
    
    // 初始棋子位置（基于旋转对称）
    static INITIAL_POSITIONS = {
        3: [ // 黑方 - 左上角
            { type: 'king', x: 0, y: 0 },
            { type: 'advisor', x: 1, y: 1 },
            { type: 'elephant', x: 0, y: 2 },
            { type: 'rook', x: 1, y: 0 },
            { type: 'horse', x: 2, y: 2 },
            { type: 'cannon', x: 1, y: 2 },
            { type: 'pawn', x: 0, y: 3 },
            { type: 'pawn', x: 2, y: 3 },
            { type: 'pawn', x: 3, y: 0 },
            { type: 'pawn', x: 3, y: 2 }
        ],
        1: [ // 蓝方 - 右上角 (顺时针旋转90度)
            { type: 'king', x: 10, y: 0 },
            { type: 'advisor', x: 9, y: 1 },
            { type: 'elephant', x: 8, y: 0 },
            { type: 'rook', x: 10, y: 1 },
            { type: 'horse', x: 8, y: 2 },
            { type: 'cannon', x: 8, y: 1 },
            { type: 'pawn', x: 7, y: 0 },
            { type: 'pawn', x: 7, y: 2 },
            { type: 'pawn', x: 10, y: 3 },
            { type: 'pawn', x: 8, y: 3 }
        ],
        2: [ // 绿方 - 右下角 (旋转180度)
            { type: 'king', x: 10, y: 10 },
            { type: 'advisor', x: 9, y: 9 },
            { type: 'elephant', x: 10, y: 8 },
            { type: 'rook', x: 9, y: 10 },
            { type: 'horse', x: 8, y: 8 },
            { type: 'cannon', x: 9, y: 8 },
            { type: 'pawn', x: 10, y: 7 },
            { type: 'pawn', x: 8, y: 7 },
            { type: 'pawn', x: 7, y: 10 },
            { type: 'pawn', x: 7, y: 8 }
        ],
        0: [ // 红方 - 左下角 (逆时针旋转90度)
            { type: 'king', x: 0, y: 10 },
            { type: 'advisor', x: 1, y: 9 },
            { type: 'elephant', x: 2, y: 10 },
            { type: 'rook', x: 0, y: 9 },
            { type: 'horse', x: 2, y: 8 },
            { type: 'cannon', x: 2, y: 9 },
            { type: 'pawn', x: 3, y: 10 },
            { type: 'pawn', x: 3, y: 8 },
            { type: 'pawn', x: 0, y: 7 },
            { type: 'pawn', x: 2, y: 7 }
        ]
    };
}

// 导出配置（如果在模块环境中）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Config;
}
