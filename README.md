# 🎮 四人象棋 | Four Player Chinese Chess

<div align="center">

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)

**一款基于Web技术开发的四人象棋单机游戏**

[快速开始](#-快速开始) • [功能特性](#-功能特性) • [游戏规则](#-游戏规则) • [技术栈](#-技术栈) • [打包分发](#-打包分发)

</div>

---

## 📖 简介

四人象棋是传统中国象棋的创新变体，支持四名玩家同时对战。游戏采用纯前端技术开发，无需后端服务器，支持在浏览器中直接运行，也可打包成独立的可执行程序。

### ✨ 特色亮点

- 🎯 **四人对战** - 独特的四方对局，策略性更强
- 🎨 **精美UI** - 使用Tailwind CSS打造现代化界面
- 💾 **本地运行** - 无需网络，完全离线可玩
- 📱 **响应式设计** - 支持不同屏幕尺寸
- 🔄 **悔棋功能** - 支持撤销上一步操作
- 📊 **移动历史** - 完整记录每步棋的移动
- 🎪 **便携分发** - 可打包成无依赖的可执行文件

---

## 🚀 快速开始

### 方法一：直接在浏览器中运行（推荐）

1. **下载项目**
   ```bash
   git clone https://github.com/coperlm/chess_4people.git
   cd chess_4people
   ```

2. **启动游戏**
   - **Windows**: 双击 `start-game.bat`
   - **手动启动**: 直接双击 `index.html` 文件

3. **开始游戏**
   - 点击"新游戏"按钮
   - 红方先行，顺时针轮流下棋

### 方法二：使用Node.js服务器

```bash
# 安装依赖（首次运行）
npm install

# 启动服务器
npm run serve
# 或
node server.js

# 浏览器访问 http://localhost:8080
```

### 方法三：打包成独立应用

```bash
# 创建便携版（无需Node.js）
./create-portable.bat

# 生成的文件夹可直接分发给他人使用
```

---

## 🎯 功能特性

### 游戏功能

- ✅ 四人对战模式（红、蓝、绿、黑）
- ✅ 队伍对抗（红绿 vs 蓝黑）
- ✅ 完整的象棋规则验证
- ✅ 智能高亮可移动位置
- ✅ 悔棋功能
- ✅ 认输功能
- ✅ 移动历史记录
- ✅ 游戏状态显示
- ✅ 棋子计数统计

### 技术特性

- 📐 **模块化架构** - 清晰的代码结构
- 🎨 **现代化UI** - Tailwind CSS + 自定义样式
- 🧩 **面向对象设计** - 可维护性强
- 🐛 **详细错误日志** - 便于调试
- 💾 **自动保存** - 游戏进度自动保存
- 🔧 **配置灵活** - 易于修改和扩展

---

## 📋 游戏规则

### 基本规则

1. **玩家与阵营**
   - 四名玩家：红方（左下）、蓝方（右上）、绿方（右下）、黑方（左上）
   - 两个队伍：红绿队 vs 蓝黑队
   - 对角线玩家为队友

2. **胜利条件**
   - 将死任意敌方玩家即可获胜
   - 队友任一方获胜，全队获胜

3. **行棋顺序**
   - 顺时针轮流：红 → 绿 → 蓝 → 黑 → 红...

4. **特殊规则**
   - 河界不可落子（仅作视觉分隔）
   - 兵/卒过河后可横向移动
   - 象不能过河
   - 马走日，炮翻山

### 棋子移动规则

| 棋子 | 移动规则 |
|------|---------|
| **帅/将** | 只能在九宫格内移动，每次一格 |
| **士/仕** | 只能在九宫格内斜线移动 |
| **相/象** | 走田字，不能过河 |
| **马** | 走日字，蹩马腿 |
| **车** | 直线移动，不限距离 |
| **炮** | 直线移动，吃子需隔一子 |
| **兵/卒** | 向前一格，过河后可横移 |

---

## 🛠️ 技术栈

### 前端技术

- **核心**: 纯JavaScript (ES6+)
- **样式**: Tailwind CSS + 自定义CSS
- **架构**: 面向对象 + 模块化设计

### 项目结构

```
chess_4people/
├── index.html              # 主页面
├── server.js              # 本地服务器（可选）
├── package.json           # 项目配置
├── start-game.bat         # Windows启动脚本
├── create-portable.bat    # 便携版打包脚本
├── js/
│   ├── main.js           # 应用入口
│   ├── board/            # 棋盘相关
│   │   ├── BoardRenderer.js      # 棋盘渲染
│   │   ├── CoordinateMapper.js   # 坐标映射
│   │   └── PieceManager.js       # 棋子管理
│   ├── game/             # 游戏逻辑
│   │   ├── GameEngine.js         # 游戏引擎
│   │   ├── GameState.js          # 游戏状态
│   │   └── RuleValidator.js      # 规则验证
│   ├── ui/               # 用户界面
│   │   └── GameInterface.js      # 界面控制
│   └── utils/            # 工具类
│       ├── Config.js             # 配置文件
│       ├── Utils.js              # 工具函数
│       └── GameStatePersistence.js # 状态保存
├── styles/
│   ├── main.css          # 主样式
│   └── style.css         # 自定义样式
└── css/
    └── input.css         # Tailwind输入
```

---

## 📦 打包分发

### 方法一：便携版HTML（推荐）

**适合**: 快速分享给朋友，无需任何环境

```bash
# 1. 双击运行
create-portable.bat

# 2. 生成"四人象棋便携版"文件夹
# 3. 压缩整个文件夹
# 4. 发送给朋友，解压后双击"启动游戏.html"即可玩
```

**优点**:
- ✅ 无需安装任何软件
- ✅ 体积小（约5MB）
- ✅ 任何电脑都能运行
- ✅ 只需双击HTML文件

### 方法二：Electron打包

**适合**: 需要专业的EXE程序

```bash
# 前置: 安装Node.js (https://nodejs.org)

# 安装依赖
npm install --save-dev electron electron-builder

# 打包Windows版
npm run build:win

# 打包Mac版
npm run build:mac

# 输出在 dist/ 文件夹
```

---

## 🎨 AI图标生成提示词

使用AI（如Midjourney、DALL-E）生成游戏图标：

### 推荐提示词：

```
Create a modern, circular app icon for a four-player Chinese chess game.
Features:
- Four "将" (Chinese chess king) characters in red, blue, green, and black
- Arranged in a cross/compass pattern
- Blue cross lines in center representing the river (楚河汉界)
- Warm golden amber background (#D97706)
- Clean flat design style, professional game icon
- 512x512 pixels, rounded corners
- High contrast, recognizable at small sizes
```

### 中国风版本：

```
Traditional Chinese chess app icon with elegant design.
- Four colored "将" characters in cardinal directions (red/blue/green/black)
- Classic wooden chess board texture
- Golden decorative border with Chinese cloud patterns
- Blue river cross in center with calligraphy "楚河汉界"
- Rich warm colors, seal stamp style
- 512x512px, traditional Chinese art aesthetic
```

---

## 🔧 开发

### 开发环境设置

```bash
# 克隆项目
git clone https://github.com/coperlm/chess_4people.git
cd chess_4people

# 安装依赖（可选）
npm install

# 启动开发服务器
npm run serve

# 构建CSS（如果修改了Tailwind）
npm run build-css
```

### 调试快捷键

- `Ctrl+Shift+I` - 显示应用信息
- `Ctrl+Shift+D` - 显示游戏状态
- `Ctrl+Z` - 悔棋
- `Ctrl+N` - 新游戏
- `ESC` - 取消选择

### 修改配置

编辑 `js/utils/Config.js` 可以修改：
- 棋盘大小
- 棋子初始位置
- 玩家颜色配置
- 游戏规则参数

---

## 📝 更新日志

### v1.0.0 (2025-10-03)
- ✨ 初始版本发布
- ✅ 完整的四人象棋功能
- ✅ 河界优化为视觉分隔线
- ✅ 移除网络功能，专注单机体验
- ✅ 添加详细错误日志
- ✅ 支持便携版打包

---

## 🤝 贡献

欢迎提交问题和功能建议！

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

---

## 📄 许可证

本项目采用 MIT 许可证。详见 [LICENSE](LICENSE) 文件。

---

## 👥 作者

- **coperlm** - *初始开发* - [GitHub](https://github.com/coperlm)

---

## 🙏 致谢

- 中国象棋传统规则
- Tailwind CSS 框架
- 所有测试和反馈的朋友们

---

## 📞 联系方式

- GitHub Issues: [提交问题](https://github.com/coperlm/chess_4people/issues)
- 项目主页: [chess_4people](https://github.com/coperlm/chess_4people)

---

<div align="center">

**⭐ 如果这个项目对你有帮助，请给它一个Star！**

Made with ❤️ by coperlm

</div>
