// 走子记谱：本变体 10×10，坐标最多一位数，故用「两位数字」表示一格（如 95 = x9,y5），不需要括号/逗号。
class Notation {
    static coord(pt) { return `${pt.x}${pt.y}`; }

    /**
     * @param move {{player, piece, from:{x,y}, to:{x,y}, captured?:{player,type}|null}}
     * @returns 形如「红方 车 95→92 吃绿方卒」
     */
    static format(move) {
        const pn = Config.PLAYER_COLORS[move.player].name;
        const kn = Config.PIECE_NAMES[move.player][move.piece];
        let cap = '';
        if (move.captured) {
            const cp = move.captured;
            cap = ` 吃${Config.PLAYER_COLORS[cp.player].name}${Config.PIECE_NAMES[cp.player][cp.type]}`;
        }
        return `${pn} ${kn} ${this.coord(move.from)}→${this.coord(move.to)}${cap}`;
    }

    /** 仅「起点→终点」的短串（回放状态行/提示用） */
    static span(from, to) { return `${this.coord(from)}→${this.coord(to)}`; }
}

if (typeof module !== 'undefined' && module.exports) module.exports = Notation;
