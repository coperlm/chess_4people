// 棋盘渲染器
class BoardRenderer {
    constructor(gameState, pieceManager, ruleValidator) {
        this.gameState = gameState;
        this.pieceManager = pieceManager;
        this.ruleValidator = ruleValidator;
        this.boardElement = document.getElementById('chessBoard');
        this.selectedCell = null;
        this.premove = null;   // 预备走子：{ from:[x,y], to:[x,y]|null }
        
        // 网络模式相关
        this.isNetworkMode = false;
        this.myColors = [];
        
        // 防抖定时器
        this.resizeTimer = null;
        
        this.initializeBoard();
        this.bindEvents();
        this.bindResizeEvent();
    }
    
    /**
     * 绑定窗口大小改变事件
     */
    bindResizeEvent() {
        window.addEventListener('resize', () => {
            // 防抖：延迟300ms后重新渲染
            clearTimeout(this.resizeTimer);
            this.resizeTimer = setTimeout(() => {
                this.initializeBoard();
            }, 300);
        });
        
        // 监听屏幕方向改变
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                this.initializeBoard();
            }, 100);
        });
    }
    
    /**
     * 设置网络模式
     */
    setNetworkMode(enabled) {
        this.isNetworkMode = !!enabled;
    }
    
    /**
     * 设置本端控制的颜色（联机用，支持一人控制多色，如 2 人局各控一队）
     */
    setPlayerPosition(colors) {
        this.myColors = Array.isArray(colors) ? colors.slice() : (colors == null ? [] : [colors]);
    }
    
    /**
     * 检查是否可以控制棋子
     */
    canControlPiece(piece) {
        if (!this.isNetworkMode) return true;
        return !!piece && this.myColors.includes(piece.player);
    }
    
    /**
     * 检查是否是当前玩家的回合
     */
    isMyTurn() {
        if (!this.isNetworkMode) return true;
        return this.myColors.includes(this.gameState.currentPlayer);
    }
    
    /**
     * 启用/禁用棋盘交互
     */
    setEnabled(on) {
        if (this.boardElement) this.boardElement.style.pointerEvents = on ? '' : 'none';
    }

    /**
     * 计算最佳棋盘尺寸（根据屏幕自动适配）
     */
    calculateBoardSize() {
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;
        
        // 预留空间给标题、按钮、侧边栏等（根据屏幕方向调整）
        const isPortrait = screenHeight > screenWidth;
        let availableWidth = isPortrait ? screenWidth * 0.95 : screenWidth * 0.6;
        let availableHeight = isPortrait ? screenHeight * 0.5 : screenHeight * 0.7;
        
        // 以“棋盘所在栏”的实际宽度为上限，避免网格超出底板
        const holder = this.boardElement && this.boardElement.closest('[class*="w-2/4"]');
        if (holder && holder.clientWidth > 0) {
            availableWidth = Math.min(availableWidth, holder.clientWidth - 40);
        }
        
        // 取较小值作为棋盘可用空间
        const availableSize = Math.min(availableWidth, availableHeight);
        
        // 计算格子大小（10 格等距；河界只是空白带，不再额外占宽度）
        const rawCell = Math.floor(availableSize / 10);
        const finalCellSize = Math.max(24, Math.min(rawCell, 70));

        return {
            cellSize: finalCellSize,
            pieceSize: Math.floor(finalCellSize * 0.88), // 棋子约 0.88 格（传统象棋几乎相接）
            fontSize: Math.floor(finalCellSize * 0.5)    // 字体随格子自适应
        };
    }
    
    /**
     * 初始化棋盘DOM结构
     */
    initializeBoard() {
        this.boardElement.innerHTML = '';
        
        // 根据屏幕大小计算棋盘尺寸
        const sizes = this.calculateBoardSize();
        const cellSize = sizes.cellSize;
        
        // 保存尺寸信息供其他方法使用
        this.cellSize = cellSize;
        this.pieceSize = sizes.pieceSize;
        this.fontSize = sizes.fontSize;
        
        // 均匀网格：10×10 等距，棋子落在交叉点；河界只是“空白带”，不再额外占宽
        this.boardElement.style.display = 'grid';
        this.boardElement.style.gridTemplateColumns = `repeat(${Config.BOARD_SIZE}, ${cellSize}px)`;
        this.boardElement.style.gridTemplateRows = `repeat(${Config.BOARD_SIZE}, ${cellSize}px)`;
        this.boardElement.style.gap = '0';
        
        for (let y = 0; y < Config.BOARD_SIZE; y++) {
            for (let x = 0; x < Config.BOARD_SIZE; x++) {
                const cell = this.createCell(x, y);
                cell.style.gridColumn = x + 1;
                cell.style.gridRow = y + 1;
                this.boardElement.appendChild(cell);
            }
        }

        // 棋盘装饰层：线格 + 九宫斜线 + 坐标 + 河界文字（纯视觉，不拦截点击）
        this._buildBoardOverlay();
        
        // 渲染棋子
        this.renderPieces();
        
        // 让“移动历史”高度不超过棋盘
        this._syncHistoryHeight();
    }
    
    /**
     * 让移动历史面板高度不超过棋盘（超长时在其内部滚动）
     */
    _syncHistoryHeight() {
        const mh = document.getElementById('moveHistory');
        if (!mh || !this.boardElement) return;
        const h = Math.round(this.boardElement.getBoundingClientRect().height);
        if (h > 120) mh.style.maxHeight = h + 'px';
    }
    
    /**
     * 创建棋盘格子
     */
    createCell(x, y) {
        const cell = document.createElement('div');
        cell.id = CoordinateMapper.positionToId(x, y);
        cell.className = 'chess-cell';
        cell.dataset.x = x;
        cell.dataset.y = y;
        
        // 动态设置格子大小
        cell.style.width = `${this.cellSize}px`;
        cell.style.height = `${this.cellSize}px`;
        
        // 设置可落子区域样式
        if (Utils.isPlayablePosition(x, y)) {
            cell.classList.add('playable');
        }
        
        return cell;
    }

    // ---- 棋盘内容区坐标（等距：每格 cellSize） ----
    _xLeft(i) { return i * this.cellSize; }
    _yTop(j) { return j * this.cellSize; }
    _xCenter(i) { return this._xLeft(i) + this.cellSize / 2; }
    _yCenter(j) { return this._yTop(j) + this.cellSize / 2; }
    _contentSize() { return Config.BOARD_SIZE * this.cellSize; }

    /**
     * 棋盘装饰层：线格（交叉点棋盘，棋子落在交点）、九宫斜线、坐标 0-9、河界文字。
     * 作为跨整格的绝对定位层叠在最上（纯视觉，pointer-events:none）。
     */
    _buildBoardOverlay() {
        const cell = this.cellSize;
        const layer = document.createElement('div');
        layer.className = 'board-overlay';
        layer.style.gridColumn = '1 / -1';
        layer.style.gridRow = '1 / -1';

        const L = this._xCenter(0), R = this._xCenter(9);
        const T = this._yCenter(0), B = this._yCenter(9);
        const lw = Math.max(1, Math.round(cell * 0.03));
        const addLine = (x, y, w, h) => {
            const d = document.createElement('div');
            d.className = 'board-line';
            d.style.left = x + 'px'; d.style.top = y + 'px';
            d.style.width = w + 'px'; d.style.height = h + 'px';
            layer.appendChild(d);
        };

        // ① 横线：最外两条贯通；其余在竖河（col4↔col5 之间）处断开
        const bankLeft = this._xCenter(4), bankRight = this._xCenter(5);
        for (let j = 0; j < Config.BOARD_SIZE; j++) {
            const y = this._yCenter(j) - lw / 2;
            if (j === 0 || j === Config.BOARD_SIZE - 1) {
                addLine(L, y, R - L, lw);
            } else {
                addLine(L, y, bankLeft - L, lw);
                addLine(bankRight, y, R - bankRight, lw);
            }
        }
        // ② 竖线：最外两条贯通；其余在横河（row4↔row5 之间）处断开
        const bankTop = this._yCenter(4), bankBottom = this._yCenter(5);
        for (let i = 0; i < Config.BOARD_SIZE; i++) {
            const x = this._xCenter(i) - lw / 2;
            if (i === 0 || i === Config.BOARD_SIZE - 1) {
                addLine(x, T - lw / 2, lw, (B - T) + lw);
            } else {
                addLine(x, T - lw / 2, lw, (bankTop - T) + lw / 2);
                addLine(x, bankBottom - lw / 2, lw, (B - bankBottom) + lw);
            }
        }

        // ③ 双线外框：在线格外侧再画一圈细线（传统象棋的外框）
        const fg = Math.max(5, Math.round(cell * 0.14));
        const frame = document.createElement('div');
        frame.className = 'board-frame-line';
        frame.style.left = (L - fg) + 'px';
        frame.style.top = (T - fg) + 'px';
        frame.style.width = (R - L + 2 * fg) + 'px';
        frame.style.height = (B - T + 2 * fg) + 'px';
        frame.style.borderRadius = Math.max(3, Math.round(cell * 0.16)) + 'px';
        layer.appendChild(frame);

        // ③ 九宫斜线（每个九宫两条对角线）
        for (let p = 0; p < 4; p++) {
            const a = Config.PALACE_AREAS[p];
            const x0 = this._xCenter(a.x[0]), y0 = this._yCenter(a.y[0]);
            const x1 = this._xCenter(a.x[1]), y1 = this._yCenter(a.y[1]);
            const dx = x1 - x0, dy = y1 - y0;
            const len = Math.hypot(dx, dy);
            const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
            const deg = Math.atan2(dy, dx) * 180 / Math.PI;
            for (const sgn of [1, -1]) {
                const ln = document.createElement('div');
                ln.className = 'palace-line';
                ln.style.left = mx + 'px'; ln.style.top = my + 'px';
                ln.style.width = len + 'px';
                ln.style.transform = `translate(-50%,-50%) rotate(${deg * sgn}deg)`;
                layer.appendChild(ln);
            }
        }

        // ④ 河界文字：河界是“同底色空白带”，只用文字 + 断线标示（横竖一致，贴近真象棋）
        if (cell >= 30) {
            const rfs = Math.max(12, Math.round(cell * 0.46));
            const midHb = (this._yCenter(4) + this._yCenter(5)) / 2;   // 横河中线
            const midVb = (this._xCenter(4) + this._xCenter(5)) / 2;   // 竖河中线
            const addRiverText = (x, y, txt, vertical) => {
                const d = document.createElement('div');
                d.className = 'river-text' + (vertical ? ' river-text--v' : '');
                d.textContent = txt;
                d.style.fontSize = rfs + 'px';
                d.style.left = x + 'px'; d.style.top = y + 'px';
                layer.appendChild(d);
            };
            addRiverText(this._xCenter(2), midHb, '楚河', false);
            addRiverText(this._xCenter(7), midHb, '汉界', false);
            addRiverText(midVb, this._yCenter(2), '楚河', true);
            addRiverText(midVb, this._yCenter(7), '汉界', true);
        }

        // ⑤ 坐标标注：贴在棋盘外沿（内边距里）。上下列=第1位(列 x)，左右行=第2位(行 y)。
        const fs = Math.max(9, Math.round(cell * 0.28));
        const off = Math.max(7, Math.round(cell * 0.16));
        const size = this._contentSize();
        const addLabel = (kind, left, top, txt) => {
            const d = document.createElement('div');
            d.className = 'axis-label axis-label--' + kind;
            d.textContent = txt;
            d.style.fontSize = fs + 'px';
            d.style.left = left + 'px';
            d.style.top = top + 'px';
            layer.appendChild(d);
        };
        for (let i = 0; i < Config.BOARD_SIZE; i++) {
            const cx = this._xCenter(i), cy = this._yCenter(i);
            addLabel('col', cx, -off, String(i));
            addLabel('col', cx, size + off, String(i));
            addLabel('row', -off, cy, String(i));
            addLabel('row', size + off, cy, String(i));
        }

        this.boardElement.appendChild(layer);
    }

    /**
     * 被将军的将/帅所在格子持续高亮（红色，直到解将）。传空数组即清除。
     */
    setCheckPlayers(players) {
        if (!this.boardElement) return;
        this.boardElement.querySelectorAll('.chess-cell.check').forEach(c => c.classList.remove('check'));
        if (!players || !players.length) return;
        const set = new Set(players);
        for (let x = 0; x < Config.BOARD_SIZE; x++) {
            for (let y = 0; y < Config.BOARD_SIZE; y++) {
                const pc = this.gameState.getPiece(x, y);
                if (pc && pc.type === Config.PIECE_TYPES.KING && set.has(pc.player)) {
                    const cell = document.getElementById(CoordinateMapper.positionToId(x, y));
                    if (cell) cell.classList.add('check');
                }
            }
        }
    }
    
    /**
     * 渲染所有棋子
     */
    renderPieces(move) {
        // 传了走子坐标就做动画（出错则退回无动画，绝不影响对局）：走子“飞行”+ 被吃子淡出
        let ghost = null, capGhost = null;
        if (move && this._animEnabled()) {
            ghost = this._captureMoveGhost(move);
            capGhost = this._captureCapturedGhost(move);
        }

        // 清除所有现有棋子
        this.clearAllPieces();

        // 重新渲染所有棋子
        for (let x = 0; x < Config.BOARD_SIZE; x++) {
            for (let y = 0; y < Config.BOARD_SIZE; y++) {
                const piece = this.gameState.getPiece(x, y);
                if (piece) {
                    this.renderPiece(piece, x, y);
                }
            }
        }

        if (ghost) this._runMoveGhost(ghost, move);
        if (capGhost) this._runCaptureGhost(capGhost);
        if (move) this._bounceLandedPiece(move);
    }

    /** 落子弹跳：走子到位后棋子轻微“压一下”（等飞行动画基本结束再触发） */
    _bounceLandedPiece(move) {
        try {
            if (!this._animEnabled()) return;
            setTimeout(() => {
                try {
                    const cell = document.getElementById(CoordinateMapper.positionToId(move.toX, move.toY));
                    const el = cell && cell.querySelector('.chess-piece');
                    if (!el) return;
                    el.classList.remove('land'); void el.offsetWidth; el.classList.add('land');
                    setTimeout(() => { try { el.classList.remove('land'); } catch (e) {} }, 320);
                } catch (e) { /* ignore */ }
            }, 180);
        } catch (e) { /* 动画失败不影响对局 */ }
    }

    _animEnabled() {
        try {
            if (typeof window !== 'undefined' && window.matchMedia
                && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
        } catch (e) { /* ignore */ }
        return true;
    }

    /** 在重绘前抓取起点棋子的“影子”（DOM 仍是走子前状态） */
    _captureMoveGhost(move) {
        try {
            const cell = document.getElementById(CoordinateMapper.positionToId(move.fromX, move.fromY));
            const el = cell && cell.querySelector('.chess-piece');
            if (!el) return null;
            return { node: el.cloneNode(true), rect: el.getBoundingClientRect() };
        } catch (e) { return null; }
    }

    /** 把影子从起点平移到终点；完成后移除并恢复终点棋子 */
    _runMoveGhost(ghost, move) {
        try {
            const toCell = document.getElementById(CoordinateMapper.positionToId(move.toX, move.toY));
            if (!toCell) return;
            const real = toCell.querySelector('.chess-piece');
            const tr = toCell.getBoundingClientRect();
            // 取消上一段未完成的动画
            if (this._ghost) { try { this._ghost.remove(); } catch (e) {} }
            if (this._ghostReal) { try { this._ghostReal.style.opacity = ''; } catch (e) {} }

            const g = ghost.node;
            g.style.position = 'fixed';
            g.style.left = ghost.rect.left + 'px';
            g.style.top = ghost.rect.top + 'px';
            g.style.width = ghost.rect.width + 'px';
            g.style.height = ghost.rect.height + 'px';
            g.style.margin = '0';
            g.style.pointerEvents = 'none';
            g.style.zIndex = '60';
            g.style.transition = 'transform .18s ease-out';
            document.body.appendChild(g);
            if (real) real.style.opacity = '0';
            this._ghost = g; this._ghostReal = real || null;

            const dx = (tr.left + (tr.width - ghost.rect.width) / 2) - ghost.rect.left;
            const dy = (tr.top + (tr.height - ghost.rect.height) / 2) - ghost.rect.top;
            requestAnimationFrame(() => { try { g.style.transform = `translate(${dx}px,${dy}px)`; } catch (e) {} });
            setTimeout(() => {
                try { g.remove(); } catch (e) {}
                try { if (real) real.style.opacity = ''; } catch (e) {}
                if (this._ghost === g) { this._ghost = null; this._ghostReal = null; }
            }, 200);
        } catch (e) { /* 动画失败不影响对局 */ }
    }

    /** 重绘前抓取“被吃子”的影子（DOM 仍是走子前，to 格上若还有子即为被吃子） */
    _captureCapturedGhost(move) {
        try {
            const cell = document.getElementById(CoordinateMapper.positionToId(move.toX, move.toY));
            const el = cell && cell.querySelector('.chess-piece');
            if (!el) return null;
            return { node: el.cloneNode(true), rect: el.getBoundingClientRect() };
        } catch (e) { return null; }
    }

    /** 被吃子：原地淡出并缩小旋转，最后移除 */
    _runCaptureGhost(ghost) {
        try {
            const g = ghost.node;
            g.style.position = 'fixed';
            g.style.left = ghost.rect.left + 'px';
            g.style.top = ghost.rect.top + 'px';
            g.style.width = ghost.rect.width + 'px';
            g.style.height = ghost.rect.height + 'px';
            g.style.margin = '0';
            g.style.pointerEvents = 'none';
            g.style.zIndex = '54';
            g.style.transition = 'opacity .3s ease, transform .3s ease';
            document.body.appendChild(g);
            requestAnimationFrame(() => { try { g.style.opacity = '0'; g.style.transform = 'scale(.4) rotate(22deg)'; } catch (e) {} });
            setTimeout(() => { try { g.remove(); } catch (e) {} }, 360);
        } catch (e) { /* 动画失败不影响对局 */ }
    }

    /**
     * 淘汰特效：把指定颜色的棋子克隆成“影子”，短暂停留后淡出缩小。
     * 必须在 renderPieces() 之前调用（此时 DOM 上还留着这些棋子）。纯视觉，失败不影响对局。
     */
    fadeOutPieces(colors, holdMs = 450, fadeMs = 380) {
        if (!colors || !colors.length || !this._animEnabled()) return;
        try {
            const set = new Set(colors);
            const clones = [];
            const pieces = this.boardElement.querySelectorAll('.chess-piece');
            pieces.forEach(el => {
                if (!set.has(parseInt(el.dataset.player, 10))) return;
                const rect = el.getBoundingClientRect();
                const g = el.cloneNode(true);
                g.style.position = 'fixed';
                g.style.left = rect.left + 'px';
                g.style.top = rect.top + 'px';
                g.style.width = rect.width + 'px';
                g.style.height = rect.height + 'px';
                g.style.margin = '0';
                g.style.pointerEvents = 'none';
                g.style.zIndex = '55';
                g.style.transition = `opacity ${fadeMs}ms ease, transform ${fadeMs}ms ease`;
                document.body.appendChild(g);
                clones.push(g);
            });
            if (!clones.length) return;
            setTimeout(() => {
                clones.forEach(g => { try { g.style.opacity = '0'; g.style.transform = 'scale(.35)'; } catch (e) {} });
                setTimeout(() => clones.forEach(g => { try { g.remove(); } catch (e) {} }), fadeMs + 80);
            }, holdMs);
        } catch (e) { /* 特效失败不影响对局 */ }
    }

    /**
     * 清除所有棋子
     */
    clearAllPieces() {
        const pieces = this.boardElement.querySelectorAll('.chess-piece');
        pieces.forEach(piece => piece.remove());
    }
    
    /**
     * 渲染单个棋子
     */
    renderPiece(piece, x, y) {
        const cell = document.getElementById(CoordinateMapper.positionToId(x, y));
        if (!cell) return;
        
        // 移除已有棋子
        const existingPiece = cell.querySelector('.chess-piece');
        if (existingPiece) {
            existingPiece.remove();
        }
        
        // 创建棋子元素
        const pieceElement = document.createElement('div');
        pieceElement.className = 'chess-piece';
        pieceElement.dataset.pieceId = piece.id;
        pieceElement.dataset.player = piece.player;
        pieceElement.dataset.type = piece.type;
        
        // 动态设置棋子大小和字体
        pieceElement.style.width = `${this.pieceSize}px`;
        pieceElement.style.height = `${this.pieceSize}px`;
        pieceElement.style.fontSize = `${this.fontSize}px`;
        pieceElement.style.lineHeight = `${this.pieceSize}px`;
        
        // 设置棋子样式
        const colorInfo = piece.getColorInfo();
        pieceElement.classList.add(colorInfo.color.replace('text-', 'text-'));
        pieceElement.classList.add(colorInfo.bg);
        pieceElement.classList.add(colorInfo.border);
        
        // 高亮规则：
        //  - 本地（同一设备轮流操四方）：高亮“当前回合方”的棋子
        //  - 联机（只能操作自己的颜色）：高亮“我自己的棋子”；轮到我时再加 my-turn 强化
        if (this.gameState.gamePhase === 'playing') {
            if (this.isNetworkMode) {
                if (this.myColors.includes(piece.player)) {
                    pieceElement.classList.add('turn-active');
                    if (piece.player === this.gameState.currentPlayer) pieceElement.classList.add('my-turn');
                }
            } else if (piece.player === this.gameState.currentPlayer) {
                pieceElement.classList.add('turn-active');
            }
        }
        
        // 设置棋子文字
        pieceElement.textContent = piece.getName();
        
        // 添加到格子中
        cell.appendChild(pieceElement);
    }
    
    /**
     * 绑定事件（支持触摸和鼠标）
     */
    bindEvents() {
        // 鼠标点击事件（拖拽结束会抑制随后合成的 click）
        this.boardElement.addEventListener('click', (e) => {
            if (this._suppressClick) { this._suppressClick = false; return; }
            this.handleCellClick(e);
        });
        
        // 触摸事件支持（移动设备）
        let touchStartTime = 0;
        let touchStartTarget = null;
        
        this.boardElement.addEventListener('touchstart', (e) => {
            touchStartTime = Date.now();
            touchStartTarget = e.target;
        }, { passive: true });
        
        this.boardElement.addEventListener('touchend', (e) => {
            // 只处理快速触摸（不是滑动）
            const touchDuration = Date.now() - touchStartTime;
            if (touchDuration < 300 && touchStartTarget === e.target) {
                // 阻止触发click事件（避免双重触发）
                e.preventDefault();
                this.handleCellClick(e);
            }
        });

        // 桌面端：按住拖拽走子（与点击选择共存；未超过阈值则由 click 处理）
        this.boardElement.addEventListener('mousedown', (e) => this._onDragStart(e));
        document.addEventListener('mousemove', (e) => this._onDragMove(e));
        document.addEventListener('mouseup', (e) => this._onDragEnd(e));
        
        // 防止移动端长按菜单
        this.boardElement.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
    }

    /** 拖拽走子：按下——只记录候选，真正开始拖拽在移动超阈值时 */
    _onDragStart(e) {
        if (e.button !== 0) return;
        if (this.isNetworkMode && !this.isMyTurn()) return;
        const cell = e.target.closest && e.target.closest('.chess-cell');
        if (!cell) return;
        const x = parseInt(cell.dataset.x), y = parseInt(cell.dataset.y);
        const piece = this.gameState.getPiece(x, y);
        if (!piece || piece.player !== this.gameState.currentPlayer) return;
        if (this.isNetworkMode && !this.canControlPiece(piece)) return;
        this._dragFrom = { x, y };
        this._dragStartPt = { x: e.clientX, y: e.clientY };
        this._dragging = false;
        this._dragEl = null; this._dragReal = null;
    }

    /** 拖拽走子：移动超过 6px 才真正进入拖拽（选中 + 跟随光标的影子） */
    _onDragMove(e) {
        if (!this._dragFrom) return;
        if (!this._dragging) {
            if (Math.hypot(e.clientX - this._dragStartPt.x, e.clientY - this._dragStartPt.y) < 6) return;
            this._dragging = true;
            this.handlePieceSelection(this._dragFrom.x, this._dragFrom.y);   // 选中 + 高亮可走点
            try {
                const cell = document.getElementById(CoordinateMapper.positionToId(this._dragFrom.x, this._dragFrom.y));
                const el = cell && cell.querySelector('.chess-piece');
                if (el && this._animEnabled()) {
                    const rect = el.getBoundingClientRect();
                    const g = el.cloneNode(true);
                    g.className = (g.className || '') + ' drag-ghost';
                    g.style.position = 'fixed';
                    g.style.left = rect.left + 'px'; g.style.top = rect.top + 'px';
                    g.style.width = rect.width + 'px'; g.style.height = rect.height + 'px';
                    g.style.margin = '0'; g.style.pointerEvents = 'none';
                    document.body.appendChild(g);
                    this._dragEl = g; this._dragW = rect.width; this._dragH = rect.height;
                    el.style.opacity = '0.35'; this._dragReal = el;
                }
            } catch (err) { /* ignore */ }
        }
        if (this._dragEl) {
            this._dragEl.style.left = (e.clientX - this._dragW / 2) + 'px';
            this._dragEl.style.top = (e.clientY - this._dragH / 2) + 'px';
        }
    }

    /** 拖拽走子：松开——落到合法格则走子，否则还原 */
    _onDragEnd(e) {
        if (!this._dragFrom) return;
        const wasDragging = this._dragging;
        const from = this._dragFrom;
        this._dragFrom = null; this._dragging = false;
        if (this._dragEl) { try { this._dragEl.remove(); } catch (err) {} this._dragEl = null; }
        if (this._dragReal) { try { this._dragReal.style.opacity = ''; } catch (err) {} this._dragReal = null; }
        if (!wasDragging) return;   // 未进入拖拽：交给 click 处理
        this._suppressClick = true;
        setTimeout(() => { this._suppressClick = false; }, 0);
        // 用几何换算落点格（不依赖命中检测，任何环境都稳）；再不济退回 elementFromPoint
        let cell = this._cellFromPoint(e.clientX, e.clientY);
        if (!cell) {
            try { const el = document.elementFromPoint(e.clientX, e.clientY); cell = el && el.closest ? el.closest('.chess-cell') : null; } catch (err) { cell = null; }
        }
        if (!cell) { this.clearSelection(); return; }
        const tx = parseInt(cell.dataset.x), ty = parseInt(cell.dataset.y);
        if (tx === from.x && ty === from.y) { this.clearSelection(); return; }
        this.handleMove(tx, ty);
    }

    /** 把视口坐标换算成棋盘格子（考虑内边距、边框与河带）；落在河带/棋盘外返回 null */
    _cellFromPoint(clientX, clientY) {
        try {
            const rect = this.boardElement.getBoundingClientRect();
            const cs = getComputedStyle(this.boardElement);
            const padL = parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
            const padT = parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth);
            const c = this.cellSize;
            const map = (v) => {
                if (v < 0 || v >= Config.BOARD_SIZE * c) return null;
                return Math.floor(v / c);
            };
            const x = map(clientX - rect.left - padL);
            const y = map(clientY - rect.top - padT);
            if (x === null || y === null || x < 0 || x > 9 || y < 0 || y > 9) return null;
            return document.getElementById(CoordinateMapper.positionToId(x, y));
        } catch (e) { return null; }
    }

    /** 非法走子：让被选的棋子抖一下（主流象棋的即时反馈） */
    shakeSelected() {
        const sel = this.gameState.selectedPiece;
        if (!sel) return;
        const cell = document.getElementById(CoordinateMapper.positionToId(sel.x, sel.y));
        const el = cell && cell.querySelector('.chess-piece');
        if (!el) return;
        try {
            el.classList.remove('shake');
            void el.offsetWidth;
            el.classList.add('shake');
            setTimeout(() => { try { el.classList.remove('shake'); } catch (e) {} }, 420);
        } catch (e) { /* ignore */ }
    }
    
    // ===================== 预备走子（仅：联机 + 恰好四人） =====================
    /**
     * 是否允许预备走子。要求：联机对局进行中、恰好 4 名玩家参战、非回放、且自己有色可走。
     * 四人轮流等待最久，预走收益最大；人数更少或本地热座不启用。
     */
    _premoveEnabled() {
        const os = window.onlineSession;
        if (!os || !os.active || !os.started) return false;
        if (!this.isNetworkMode) return false;
        if (window.replay && window.replay.active) return false;
        if (!this.myColors || !this.myColors.length) return false;
        const players = (os.participants || []).filter(p => p && p.colors && p.colors.length);
        return players.length === 4;
    }

    /** 非己方回合的点击：设置 / 改选 / 取消「预备走子」 */
    _handlePremoveClick(x, y) {
        const gs = this.gameState;
        // 再点一次起点 = 取消
        if (this.premove && this.premove.from[0] === x && this.premove.from[1] === y) {
            this.cancelPremove();
            Utils.showMessage('已取消预备走子', 'info');
            return;
        }
        const piece = gs.getPiece(x, y);
        // 点自己的棋子 → 记为预备起点
        if (piece && this.myColors.includes(piece.player)) {
            this.premove = { from: [x, y], to: null };
            this._renderPremove();
            return;
        }
        // 已有起点 → 设落点（用“忽略回合”的校验，确认这一步本身成立）
        if (this.premove && this.premove.from) {
            const [fx, fy] = this.premove.from;
            if (!this.ruleValidator.isValidMove(fx, fy, x, y, true)) {
                Utils.showMessage('这一步走不了', 'warning');
                return;
            }
            this.premove.to = [x, y];
            this._renderPremove();
            Utils.showMessage('预备走子已记下，轮到你时自动执行', 'info');
        }
    }

    /** 轮到自己时尝试执行预备走子（由 GameEngine.updateUI 调用） */
    tryExecutePremove() {
        if (!this.premove || !this.premove.to) return;
        // 条件不再满足（离开房间/人数变化/回放）→ 直接清掉
        if (!this._premoveEnabled()) { this.cancelPremove(); return; }
        if (this.gameState.gamePhase !== 'playing' || !this.isMyTurn()) return;   // 还没轮到，继续等待
        const [fx, fy] = this.premove.from;
        const [tx, ty] = this.premove.to;
        const piece = this.gameState.getPiece(fx, fy);
        const okPiece = !!(piece && this.myColors.includes(piece.player));
        const okMove = okPiece && this.ruleValidator.isValidMove(fx, fy, tx, ty);
        const selfCheck = okMove && this.ruleValidator.wouldBeInCheckAfterMove(fx, fy, tx, ty, piece.player);
        this.cancelPremove();
        if (!okMove || selfCheck) {
            Utils.showMessage(selfCheck ? '预备走子会让你被将军，已取消' : '预备走子已失效', 'warning');
            return;
        }
        this._proceedMove(fx, fy, tx, ty);
    }

    /** 清除预备走子状态与高亮 */
    cancelPremove() {
        if (!this.premove) return;
        this.premove = null;
        this._clearPremoveVisual();
    }

    _renderPremove() {
        this._clearPremoveVisual();
        if (!this.premove) return;
        const [fx, fy] = this.premove.from;
        const fc = document.getElementById(CoordinateMapper.positionToId(fx, fy));
        if (fc) fc.classList.add('premove-from');
        if (this.premove.to) {
            const [tx, ty] = this.premove.to;
            const tc = document.getElementById(CoordinateMapper.positionToId(tx, ty));
            if (tc) tc.classList.add('premove-to');
        }
    }

    _clearPremoveVisual() {
        if (!this.boardElement) return;
        this.boardElement.querySelectorAll('.premove-from, .premove-to')
            .forEach(c => c.classList.remove('premove-from', 'premove-to'));
    }

    /**
     * 处理格子点击事件
     */
    handleCellClick(e) {
        const cell = e.target.closest('.chess-cell');
        if (!cell) return;
        
        const x = parseInt(cell.dataset.x);
        const y = parseInt(cell.dataset.y);
        
        // 网络模式下检查是否是自己的回合
        if (this.isNetworkMode && !this.isMyTurn()) {
            // 预备走子：仅“联机 + 恰好四人”时可用（见 _premoveEnabled）
            if (this._premoveEnabled()) { this._handlePremoveClick(x, y); return; }
            Utils.showMessage('现在不是你的回合', 'warning');
            return;
        }
        
        if (this.gameState.selectedPiece) {
            // 已有选中的棋子，尝试移动
            this.handleMove(x, y);
        } else {
            // 选择棋子
            this.handlePieceSelection(x, y);
        }
    }
    
    /**
     * 处理棋子选择
     */
    handlePieceSelection(x, y) {
        const piece = this.gameState.getPiece(x, y);
        
        // 网络模式下只能选择自己的棋子
        if (this.isNetworkMode) {
            if (!piece || !this.canControlPiece(piece)) {
                Utils.showMessage('只能选择自己的棋子', 'warning');
                return;
            }
            if (piece.player !== this.gameState.currentPlayer) {
                Utils.showMessage('还没轮到你', 'warning');
                return;
            }
        } else {
            // 单机模式下只能选择当前玩家的棋子
            if (!piece) return;
            if (piece.player !== this.gameState.currentPlayer) {
                Utils.showMessage(`现在轮到${Config.PLAYER_COLORS[this.gameState.currentPlayer].name}走棋`, 'warning');
                return;
            }
        }
        
        // 选择棋子
        if (this.gameState.selectPiece(x, y)) {
            this.highlightSelectedPiece(x, y);
            this.showPossibleMoves();
        }
    }
    
    /**
     * 处理移动
     */
    handleMove(x, y) {
        const selected = this.gameState.selectedPiece;
        
        // 检查是否点击了同一个棋子（取消选择）
        if (selected.x === x && selected.y === y) {
            this.clearSelection();
            return;
        }
        
        // 检查是否选择了新的己方棋子
        const targetPiece = this.gameState.getPiece(x, y);
        if (targetPiece && targetPiece.player === this.gameState.currentPlayer) {
            this.clearSelection();
            this.handlePieceSelection(x, y);
            return;
        }
        
        // 尝试移动
        if (this.ruleValidator.isValidMove(selected.x, selected.y, x, y)) {
            // 本变体不强制应对将军：若这步走完本方会被将军（无视将军 / 自暴将），页内二次确认；
            // 能解将的走法天然不会触发。
            const fx = selected.x, fy = selected.y;
            const mover = this.gameState.getPiece(fx, fy);
            if (mover && this.ruleValidator.wouldBeInCheckAfterMove(fx, fy, x, y, mover.player)) {
                Utils.confirmModal('走这步后你的将/帅会被将军（可能被吃），确定继续吗？').then(ok => {
                    if (ok) this._proceedMove(fx, fy, x, y);
                });
                return;
            }
            this._proceedMove(fx, fy, x, y);
        } else {
            Utils.showMessage('无效移动！', 'error');
            this.shakeSelected();
        }
    }

    /** 真正落子：联机交给房主权威校验后广播，本地直接执行 */
    _proceedMove(fx, fy, tx, ty) {
        if (this.isNetworkMode && window.onlineSession && window.onlineSession.active) {
            window.onlineSession.requestMove(fx, fy, tx, ty);
            this.clearSelection();
        } else {
            this.executeMove(fx, fy, tx, ty);
        }
    }
    
    /**
     * 执行移动
     */
    executeMove(fromX, fromY, toX, toY) {
        try {
            
            const piece = this.gameState.getPiece(fromX, fromY);
            const capturedPiece = this.gameState.getPiece(toX, toY);
            
            
            // 执行移动
            if (this.gameState.movePiece(fromX, fromY, toX, toY)) {

                // 播放移动音效（吃子/普通；音效默认开启，可在设置里关闭）
                this.playMoveSound(!!capturedPiece);
                
                // 更新界面（带平移“飞行”动画）
                this.clearSelection();
                this.renderPieces({ fromX, fromY, toX, toY });

                // 显示移动信息
                const moveText = Notation.format({ player: piece.player, piece: piece.type, from: { x: fromX, y: fromY }, to: { x: toX, y: toY }, captured: capturedPiece });
                Utils.showMessage(moveText, 'success');
                
                // 检查游戏是否结束
                if (this.gameState.checkGameEnd()) {
                    this.handleGameEnd();
                }
                
                // 通知游戏引擎更新状态
                if (window.gameEngine) {
                    window.gameEngine.onMoveCompleted();
                } else {
                    console.warn('⚠️ window.gameEngine 不存在');
                }
            } else {
            }
        } catch (error) {
            console.error('❌ 执行移动时出错:', error);
            Utils.showMessage('移动执行出错: ' + error.message, 'error');
        }
    }
    
    /**
     * 高亮选中的棋子
     */
    highlightSelectedPiece(x, y) {
        this.clearHighlights();
        
        const cell = document.getElementById(CoordinateMapper.positionToId(x, y));
        const piece = cell.querySelector('.chess-piece');
        
        if (piece) {
            piece.classList.add('selected');
            this.selectedCell = cell;
        }
    }
    
    /**
     * 显示可能的移动
     */
    showPossibleMoves() {
        if (!this.gameState.selectedPiece) return;
        
        const moves = this.ruleValidator.getValidMoves(
            this.gameState.selectedPiece.x,
            this.gameState.selectedPiece.y
        );
        
        // gameState.selectedPiece 是 { x, y, piece } 包装对象（不是棋子本身）
        const sel = this.gameState.selectedPiece;
        const selPiece = sel && sel.piece;
        const selPlayer = (selPiece && selPiece.player != null) ? selPiece.player : null;
        const selType = selPiece ? selPiece.type : null;
        const glyph = (selPlayer != null && selType && Config.PIECE_NAMES[selPlayer])
            ? Config.PIECE_NAMES[selPlayer][selType] : '';

        moves.forEach(move => {
            const cell = document.getElementById(CoordinateMapper.positionToId(move.x, move.y));
            if (cell) {
                const targetPiece = this.gameState.getPiece(move.x, move.y);
                if (targetPiece) {
                    cell.classList.add('enemy-piece');
                } else {
                    cell.classList.add('possible-move');
                    // 空格落点用「半透明棋子预览」代替小圆点（纯 CSS 伪元素渲染，
                    // 随 class 移除自动消失，不需要额外 DOM 清理）
                    if (glyph) {
                        cell.dataset.hint = glyph;
                        cell.dataset.hp = String(selPlayer);
                    }
                }
            }
        });
        
        this.gameState.possibleMoves = moves;
    }
    
    /**
     * 清除选择状态
     */
    clearSelection() {
        this.gameState.selectedPiece = null;
        this.gameState.possibleMoves = [];
        this.selectedCell = null;
        this.clearHighlights();
    }
    
    /**
     * 清除所有高亮
     */
    clearHighlights() {
        // 清除选中状态
        const selected = this.boardElement.querySelectorAll('.chess-piece.selected');
        selected.forEach(piece => piece.classList.remove('selected'));
        
        // 清除可能移动的高亮
        const highlighted = this.boardElement.querySelectorAll('.possible-move, .enemy-piece');
        highlighted.forEach(cell => {
            cell.classList.remove('possible-move', 'enemy-piece');
        });
    }
    
    /**
     * 处理游戏结束
     */
    handleGameEnd() {
        this.cancelPremove();
        const winner = this.gameState.winner;
        let message = '';
        
        if (winner === 'TEAM1') {
            message = '红蓝队获胜！';
        } else if (winner === 'TEAM2') {
            message = '绿黑队获胜！';
        } else {
            message = '游戏结束！';
        }
        
        Utils.showMessage(message, 'success');
        
        // 禁用棋盘交互
        this.boardElement.style.pointerEvents = 'none';
    }
    
    /**
     * 播放移动音效（吃子 vs 普通）
     */
    playMoveSound(captured) {
        if (window.sound) window.sound.play(captured ? 'capture' : 'move');
    }
    
    /**
     * 重置棋盘
     */
    reset() {
        try {
            
            this.clearSelection();
            this.cancelPremove();
            
            if (this.boardElement) {
                this.boardElement.style.pointerEvents = 'auto';
            } else {
                console.warn('⚠️ boardElement 不存在');
            }
            
            this.renderPieces();
            
        } catch (error) {
            console.error('❌ 重置棋盘时出错:', error);
            Utils.showMessage(`棋盘重置失败: ${error.message}`, 'error');
        }
    }
    
    /**
     * 更新界面显示
     */
    update() {
        this.renderPieces();
        this.clearHighlights();
    }
    
    /**
     * 高亮最后一步移动
     */
    highlightLastMove() {
        // 清除上一次的最后一步标记（保留到下一步再更新，符合主流象棋）
        if (this._lastMoveCells) {
            this._lastMoveCells.forEach(c => { try { c.classList.remove('last-move-from', 'last-move-to'); } catch (e) {} });
            this._lastMoveCells = null;
        }
        const lastMove = this.gameState.getLastMove();
        if (!lastMove) return;
        const fromCell = document.getElementById(
            CoordinateMapper.positionToId(lastMove.from.x, lastMove.from.y)
        );
        const toCell = document.getElementById(
            CoordinateMapper.positionToId(lastMove.to.x, lastMove.to.y)
        );
        if (fromCell && toCell) {
            fromCell.classList.add('last-move-from');
            toCell.classList.add('last-move-to');
            this._lastMoveCells = [fromCell, toCell];
        }
    }
}

// 导出类（如果在模块环境中）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BoardRenderer;
}
