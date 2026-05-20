# Select-to-Speak: 英语学习朗读与精听助手

这是一个为英语学习者量身定制的 Chrome 浏览器插件项目，支持在网页中选择任意英语文本进行高质量的朗读与精听训练。

---

## 🏗️ 系统架构图

```mermaid
graph TD
    UserSelection[用户选择网页文本] --> ContextMenu[右键点击菜单]
    ContextMenu -->|播放 selection| Background[background.js]
    ContextMenu -->|精听 selection| Background
    
    Background -->|消息通信| ContentScript[content.js (Shadow DOM)]
    
    ContentScript -->|1. 播放功能| FloatingPlayer[浮动悬浮播放器]
    ContentScript -->|2. 精听功能| SideDrawer[侧边栏精听抽屉]
    
    FloatingPlayer -->|TTS 音频请求| FastAPITTS[/api/tts]
    SideDrawer -->|句子拆分请求| FastAPISplit[/api/split-sentences]
    SideDrawer -->|单句 TTS 请求| FastAPITTS
    
    FastAPISplit -->|spaCy 拆句器| FastAPI[FastAPI Backend]
    FastAPITTS -->|edge-tts 语音合成| FastAPI
```

- **后端服务 (`apps/api`)**：基于 Python FastAPI 框架，使用 `edge-tts` 调用微软 Edge 免费高品质大模型语音接口，结合 `spaCy` (使用轻量级的 blank English 结构和 sentencizer 分词管道) 快速高精度拆分句子。
- **浏览器插件 (`apps/web-extension`)**：遵循 Manifest V3 标准，UI 组件全部在**隔离的 Shadow DOM** 中渲染。这保证了插件的 Tailwind CSS 样式与任意宿主网页完全独立，互不污染，且不会被网页自带的样式强行覆盖。

---

## ✨ 核心功能特性

### 1. 网页划词朗读 (Play Selection)
在任意页面选择一段英文，右键菜单选择“播放 Selection”：
- 页面会出现一个**精致的、可任意拖动的悬浮播放器**。
- 播放器集成 Loading 加载动画、播放/暂停、快进/快退 5 秒等常见多媒体操作。
- 播放器具备视口边界检测，绝不会拖动到屏幕外面去。

### 2. 单句精听抽屉 (Intensive Listening Drawer)
在网页中划选多段或长篇文本，右键菜单选择“精听 Selection”：
- 屏幕右侧平滑滑入一个**极具现代设计感的毛玻璃抽屉**。
- 顶部自动调用后端 spaCy 接口，将长文本按真实英语标点习惯拆分为单个句子。
- 每个句子卡片具备序号标识，鼠标悬浮呈现高光，正在播放的句子呈现高雅的紫色（Active）突出样式。
- **智能滚动条对齐**：当切换到下一个句子播放时，抽屉滚动条将**平滑自动定位，使当前播放的句子始终完美显示在屏幕的垂直正中间**。
- **固定底部播放器 (Sticky Footer Player)**：底部的音频控制器不跟随句子滚动，永久贴合在抽屉底部。提供“单句循环(Loop)”、“重播单句”、“上一句/下一句”切换、以及进度条跳转等高级学习功能。

### 3. 高颜值设置中心 (Premium Options Page)
在插件的设置选项页面中，用户可以进行个性化配置：
- **后端服务地址自动适配**：内置自动环境识别（开发模式自动请求 `http://localhost:8000`，发布模式自动适配生产服务），移除了手动输入框防错防误触，同时保留了一键测试后端连接的毫秒级测速功能。
- **微软 Edge 高品质发音人选择**：可直接拉取后端支持的高音质发音人列表（如最自然的 Ava 少女音、Andrew 暖男音等）。
- **语速调节 (Rate) 模块**：提供直观的配置指引与快捷说明（如 `+10%` 加速听力，`-15%` 慢速辨音）。

---

## 🛠️ 后端服务部署 (`apps/api`)

后端服务支持 **Docker Compose 一键部署**（推荐）或 **本地 Python 环境部署**。

### 选项 A：使用 Docker Compose 一键部署（推荐 ⚡）
项目根目录下已配置好 `docker-compose.yml`，宿主机外部端口映射为 **`18002`**：
```bash
# 在项目根目录下启动后端服务
docker compose up -d --build
```
启动后，API 服务将运行在 `http://localhost:18002`。

### 选项 B：使用本地 Python 环境部署
本地开发需要 Python 3.9+ 运行环境：
1. **安装依赖**：
   ```bash
   cd apps/api
   python -m pip install -r requirements.txt
   ```
2. **启动服务**：
   ```bash
   python main.py
   ```
   本地服务启动后运行在 `http://localhost:8000`。若使用本地部署，请在插件 `options.js` 和 `content.js` 中将开发模式地址改为 `8000` 端口。

### 3. API 接口规范
- **拆分句子**：`POST /api/split-sentences`
  - Body: `{"text": "Hello world. Let's study English!"}`
  - Response: `{"sentences": ["Hello world.", "Let's study English!"]}`
- **TTS 音频流**：`GET /api/tts?text=Hello&rate=+0%&voice=en-US-AvaNeural`
  - Response: 字节音频流（`audio/mpeg`）
- **获取发音人**：`GET /api/voices`
  - Response: 支持的高清语音列表

---

## 🧩 浏览器插件安装 (`apps/web-extension`)

### 1. 编译 Tailwind CSS 样式
插件采用标准的 Tailwind CSS 进行静态样式预编译（规避 Chrome 扩展对 inline-script/CDN 的安全限制）：
```bash
cd apps/web-extension
npm install
npm run build:css
```
这将在 `dist` 目录下输出高度优化的单一 CSS 样式表 `dist/tailwind.css`。

### 2. 载入扩展程序
1. 打开 Google Chrome 或 Edge 浏览器，进入扩展管理页面（在地址栏输入 `chrome://extensions/`）。
2. 在右上角开启“**开发者模式**”（Developer mode）。
3. 点击左上角的“**加载已解压的扩展程序**”（Load unpacked）。
4. 选择项目中的 `apps/web-extension` 目录即可成功载入。

---

## 💡 使用小贴士 (Tips)
- **如果无法朗读**：请右键点击插件图标进入“选项”，点击“⚡ 测试后端连接”按钮，确保本地 API 处于运行状态。
- **推荐语速设置**：
  - 正常语速：`+0%` (微软默认音速)
  - 考试进阶（雅思/托福等）：`+15%` 至 `+25%`
  - 基础精听模仿（Shadowing）：`-10%`
