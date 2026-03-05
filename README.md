# 🚀 Crash Multiplayer — 部署指南

## 文件说明
```
crash-multiplayer/
├── server.js     ← Node.js WebSocket 游戏服务器
├── index.html    ← 前端游戏页面（Telegram Mini App）
├── package.json  ← Node 依赖
└── railway.json  ← Railway 一键部署配置
```

---

## 步骤一：部署 WebSocket 服务器（Railway 免费）

### 1. 推送到 GitHub
```bash
git init
git add .
git commit -m "crash game server"
git remote add origin https://github.com/你的用户名/crash-server.git
git push -u origin main
```

### 2. 在 Railway 部署
1. 打开 https://railway.app，用 GitHub 登录
2. New Project → Deploy from GitHub Repo → 选择你的仓库
3. 等待部署完成，获得域名如：`crash-server.up.railway.app`

### 3. 记录你的服务器地址
```
WSS 地址：wss://crash-server.up.railway.app
```

---

## 步骤二：修改前端 WS 地址

打开 `index.html`，找到第 ~290 行：

```javascript
const host = location.hostname === 'localhost'
  ? 'localhost:3000'
  : 'YOUR_SERVER_HOST_HERE';   // ← 改成你的Railway域名
```

改为：
```javascript
  : 'crash-server.up.railway.app';   // 不需要 wss:// 前缀
```

---

## 步骤三：部署前端（GitHub Pages）

将修改好的 `index.html` 改名为前端仓库的 `index.html`：

```bash
# 新建前端仓库
mkdir crash-frontend && cd crash-frontend
cp ../index.html .
git init && git add . && git commit -m "frontend"
git remote add origin https://github.com/你的用户名/crash-frontend.git
git push -u origin main
```

在 GitHub 仓库 Settings → Pages → Branch: main → Save

获得前端地址：`https://你的用户名.github.io/crash-frontend/`

---

## 步骤四：配置 Telegram Mini App

在 @BotFather 中：
```
/newapp
→ 选择你的 Bot
→ Web App URL: https://你的用户名.github.io/crash-frontend/
```

---

## 本地测试

```bash
npm install
npm start
# 打开 http://localhost:3000 后，直接访问 index.html 即可
```

多开几个浏览器标签页，即可看到多人实时对战效果 ✅

---

## 架构说明

```
[Player A] ←──WebSocket──┐
[Player B] ←──WebSocket──┤  server.js (Node.js)
[Player C] ←──WebSocket──┘     └── 统一管理游戏状态
                                └── 广播 tick / crash / bet 事件
                                └── 防作弊：crash点在服务端生成
```

## 游戏特性

| 功能 | 说明 |
|------|------|
| 真实多人 | WebSocket 实时同步所有玩家状态 |
| 服务端防作弊 | Crash点由服务器crypto随机生成，客户端不可预测 |
| 自动重连 | 断线后指数退避自动重连 |
| 延迟显示 | 右上角实时显示 Ping 值 |
| 自动提现 | 设置目标倍数，服务端触发 auto cashout |
| TG 集成 | 震动反馈 / 用户名读取 |
