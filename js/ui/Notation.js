// 记谱：把同一份走子数据渲染为「坐标记谱」或「中文记谱」。
// 说明：四人 10×10 变体没有传统“九路两方、进退平”的语义（每方朝两个邻敌、棋盘为四象限），
// 故“中文记谱”采用「中文数字坐标」形式；两种记谱由同一份走子数据渲染，可相互转换。
class Notation {
    static CN_DIGIT = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

    static coord(pt) { return `(${pt.x},${pt.y})`; }
    static chinese(pt) { return `(${this.CN_DIGIT[pt.x]},${this.CN_DIGIT[pt.y]})`; }

    static pieceLabel(player, type) { return Config.PIECE_NAMES[player][type]; }
    static playerLabel(player) { return Config.PLAYER_COLORS[player].name; }

    /**
     * @param move {{player, piece, from:{x,y}, to:{x,y}, captured?:{player,type}|null}}
     * @param style {'coord'|'cn'}
     */
    static format(move, style = 'coord') {
        const pn = this.playerLabel(move.player);
        const kn = this.pieceLabel(move.player, move.piece);
        const pos = style === 'cn'
            ? `${this.chinese(move.from)}→${this.chinese(move.to)}`
            : `${this.coord(move.from)}→${this.coord(move.to)}`;
        let cap = '';
        if (move.captured) {
            const cp = move.captured;
            cap = ` 吃${this.playerLabel(cp.player)}${this.pieceLabel(cp.player, cp.type)}`;
        }
        return `${pn} ${kn} ${pos}${cap}`;
    }

    /** 仅出“起点→终点”的短串（回放状态行用） */
    static span(from, to, style = 'coord') {
        const f = style === 'cn' ? this.chinese(from) : this.coord(from);
        const t = style === 'cn' ? this.chinese(to) : this.coord(to);
        return `${f}→${t}`;
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = Notation;
