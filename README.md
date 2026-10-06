# Four-way-Xiangqi

纯前端的支持1-4人的变体中国象棋，支持免服务器联机（基于WebRTC P2P+Trystero），已部署到 GitHub Pages。

![](assets/images/Screenshot-pc.jpg)

<img src="assets/images/Screenshot-pe.jpg" width="50%">

## 功能

- **两种对局方式**：`本地对战`（同一设备轮流操作四个颜色）、`联机对战`（创建房间后，用邀请链接或房间号加入）。
- **两种对战模式**：`两两组队`（红蓝 vs 绿黑，对角线是队友）、`四人混战`（各自为战，按死亡顺序排 1–4 名）。
- **胜利条件**：`吃将任意一方即结束`（默认）/ `仅剩一队`。
- **友伤**：可开关`允许吃队友棋子`。
- **求和**：对局中可提议和棋（本地直接和；联机需其余玩家全部同意）。
- **悔棋 / 吃子**：可多次悔棋，每次记入独立的「悔棋记录」；吃子托盘按颜色展示被吃棋子。
- **设置**：深色模式、音效（默认开启），自动保存。
- **记谱**：走子显示为两位数字坐标（如 `95` 即第 9 列第 5 行；10×10 下每位都是一位数，无需分隔符）。
- **对局回放**：导出为单行编码，导入后按当前「记谱方式」列出走法、逐手查看、可点击跳转。
- **联机容错**：房主刷新自动续局；房主掉线 20 秒后由在线玩家自动接任。
- **响应式**：桌面 / 平板 / 安卓手机自适应（窄屏单列、棋盘置顶、触摸友好）。
- **预备走子（仅四人联机）**：还没轮到你时，可先点自己的子再点目标格（紫色虚线框）；轮到你时自动执行，若那时已不合法或会让你被将军则自动取消。

## 联机对战（免服务器）
1. 项目已部署到 [GitHub Pages](https://coperlm.github.io/Four-way-Xiangqi/)。
2. 一人点 **新游戏 → 联机对战 → 创建房间**，点 **复制邀请链接** 并分享给其他人。
3. 其他人 **打开该邀请链接**（`...?room=xxxx`）即自动加入房间。
4. 房主选 **对战模式 / 胜利条件 / 友伤**，点 **开始 / 重开对局**。

## 规则

- 棋盘 10×10，中间横竖两条"楚河汉界"为分隔线（不可落子）；四角 5×5 为四家区域（红左下 / 蓝右上 / 绿右下 / 黑左上）。
- 棋子走法同传统象棋：帅/将（九宫直一格）、士/仕（九宫斜一格）、相/象（走田不过河、塞象眼）、马（走日、蹩马腿）、车（直线）、炮（隔一子吃）、兵/卒（**未过河只前进，过河后可前进+侧移，永不后退**；每个兵朝向由初始位置固定）。
- **命名**：红+蓝用「帅/士/相/兵」，绿+黑用「将/仕/象/卒」。
- **将军不强制应对**：被将军时仍可自由走子；若所选走法走完后本方仍/会被将军，会弹窗二次确认（能解将的走法不弹窗）。只有「将/帅被吃」或「困毙（完全无子可动）」才出局；本变体不采用「将帅照面」规则。
- 详见游戏内「游戏规则」。

## 联机要点

- 房主校验每手并广播"走子"，其他端用同一套规则复核后再落子；非法走子会被拒绝并请求重同步。没有中立后端，无法从根本上阻止房主改自己浏览器；本作为朋友局定位。
- 身份使用用本机 `localStorage` 中的 token 识别（故换设备/清缓存等于新身份）。
- 房主状态随时存本地，刷新后自动重连同一房间续局；失联超时由在线玩家中 `selfId` 最小者接任。
- 联机信令走公共网络，个别网络环境下可能连不上；无 TURN 时少数 NAT 打不通。

## 对局回放

- 导出：`对局记录 → 导出回放`，得到一个单行编码文件 `.xq4`。
- 导入：`对局记录 → 导入回放`，底部出现控制条可逐手查看、可点击跳转。
- 文件内含加盐哈希签名：文件被改动过会校验失败、直接拒绝导入。

## 项目架构

```
index.html                 # 页面 + 弹窗
styles/style.css           # 全部样式（主题/棋盘/弹窗/响应式）
js/
  utils/Config.js          # 棋盘/角色/命名/规则常量
  utils/Utils.js           # 工具函数
  utils/GameStatePersistence.js  # 本地存档（含规则）
  game/GameState.js        # 棋盘状态、规则数据、淘汰与排名
  game/RuleValidator.js    # 走法合法性
  game/GameEngine.js       # 流程编排（UI/胜负/历史）
  game/Replay.js           # 回放导出/导入/校验
  board/{BoardRenderer,CoordinateMapper,PieceManager}.js
  net/OnlineSession.js     # 联机（Trystero P2P，房主权威）
  ui/GameInterface.js      # 界面与弹窗
  main.js                  # 入口
vendor/trystero.nostr.iife.js  # 打包后的 Trystero（无需 CDN）
server.js                  # 局域网静态服务器（可选）
tools/build-web.js         # 生成 www/（Capacitor 打包用的静态资源暂存，白名单拷贝）
tools/make-android-icons.sh # 由 assets/icons 生成安卓图标与启动图（ImageMagick）
capacitor.config.json      # Capacitor 配置（appId / webDir）
android/                   # Capacitor 生成的安卓工程（Gradle 已定制：版本号、签名）
test/                      # Node 测试（规则/联机协议/回放/随机化压力）
```

## 后续工作

### 1. AI 人机对战
- 目标：让一人也能对电脑，或空座位由 AI 托管。
- 方案：轻量内嵌（位面评估 + Alpha-Beta / MCTS，在小棋盘上可行）；或接 Pikafish（WASM，强度高但体积大、且需适配 4 人 10×10 变体）。
- 关键难点：变体没有现成引擎，现成象棋引擎都是 9×10 两人制，规则/棋盘不同，无法直接用；需要自研走子搜索与评估。
- 影响面：新增 `js/ai/`，与 `GameEngine` 回合流程、`OnlineSession` 可选托管耦合。

### 2. 残局摆子 / 复盘编辑
- 目标：在棋盘上自由摆放棋子，做残局练习或复盘到任意局面再续下。
- 影响面：`BoardRenderer` 需支持“编辑模式”（点击放/取子），`GameState` 需支持从任意局面快照开始；与存档、回放、联机同步都有交互。

## 测试

```bash
npm test        # 节点内 9 套：规则 / 引擎结算 / 联机协议 / 联机混沌(虚拟时钟) / 回放 / 存档 / 深度 / 压力 / 联机压测
npm run e2e     # 真浏览器多端 E2E：headless chromium 开两个隔离上下文，跑一遍联机全流程（需本机有 chromium）
```

- `npm test` 全部在 Node 内运行、**不需要网络与浏览器**，秒级完成（每步都跑不变量 + 多端一致性比对）。
- `test/netstress.test.js`：2/3/4/5 人随机对局 + 随机操作（悔棋/认输/求和/踢人/掉线重连/重开），查失步。
- `test/netchaos.test.js`：用**虚拟时钟**把「离线 30s 自动跳过」「房主失联 20s 接任」瞬间步进，专抓**时序竞态**。
- `npm run e2e`：在**真实浏览器**里验证跨端同步与真实 DOM 渲染；离线运行（由 CDP 驱动中转消息，不依赖公共中继）。

## Android APK

APK 由 GitHub Actions 构建，**本机不需要装 Android SDK**。

- **正式包**：把 `package.json` 的 `version` 改大并 push（与网页版发版同一个动作）→ 自动打 tag、建 Release，并把签名 APK 一并传到该 Release。
- **临时包**：Actions → `Auto Tag & Release` → `Run workflow`（只出 APK，不碰 tag / Release）。
- 未配置签名密钥时，CI 出的是 `-debug-signed` 包：能装能玩，但不能上架、也不能覆盖正式包升级。

### 签名密钥（一次性）

密钥由你自己生成并保管，仓库里不含任何密钥。生成后填进仓库 Secrets（`Settings → Secrets and variables → Actions`）：

```bash
# 生成密钥（会提示输入口令；PKCS12 下"密钥口令"直接回车沿用密钥库口令即可）
keytool -genkeypair -keystore release.jks -alias chess4p \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=chess4p, OU=dev, O=Four-way-Xiangqi, C=CN"
base64 -w0 release.jks        # 输出的一长串（无换行）就是 ANDROID_KEYSTORE_BASE64
```

| Secret | 值 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 release.jks` 的输出 |
| `ANDROID_KEYSTORE_PASSWORD` | 生成时设的密钥库口令 |
| `ANDROID_KEY_ALIAS` | `chess4p`（必须与 `-alias` 一致） |
| `ANDROID_KEY_PASSWORD` | 与密钥库口令**相同**（PKCS12 不支持两者不同） |

⚠️`release.jks` 别放进仓库（`.gitignore` 已挡 `*.jks`），放仓库外目录并连同口令一起备份。keystore 丢了就无法再给已装的包升级（只能卸载重装）。

### APK 与网页版的差异

- 页面资源内嵌在安装包里（origin 是 `https://localhost`），**单机离线可玩**；联机仍需联网（P2P 信令走公共中继）。
- **联机靠房间号**：APK 里「复制邀请链接」复制的是 4 位房间号，对方在游戏里点「加入房间」输入即可（网页版照旧可直接点链接加入）。
- `versionCode` 由 `package.json` 版本号映射而来（`2.2.1 → 20201`），发版仍只改 `package.json` 一处。
- 返回键不退出应用，而是退回桌面——误触不至于丢掉整局联机。
- 改了图标要重新生成：`bash tools/make-android-icons.sh`（需 ImageMagick）。

### 本机出包（可选）

需要 Android SDK + **JDK 17~21**（Gradle 8.14 带不动更新的 JDK，本机 JDK 27 会失败）：

```bash
npm run cap:sync
cd android && ./gradlew assembleRelease      # 产物在 android/app/build/outputs/apk/release/
```

## 开发

最初版本是 [coperlm](https://github.com/coperlm) 和他的小笨模型写的，然后一大堆bug，最后修不好了然后只能暂时扔一边了；于 2026/10/04 使用 Qwen 3.8 Max 大范围重构，使用 DeepSeek V4.1flash 完善细节并修复 bug，最终于 2026/10/06 完成 `v2.2.0` 可用版本。

欢迎 Pr 和 Issue。

## 许可

MIT
