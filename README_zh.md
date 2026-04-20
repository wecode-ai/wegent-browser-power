# Wegent Browser Power

[English](README.md) | **中文**

Wegent Browser Power 是一款专为开发者与产品经理打造的嵌入式 AI 提效插件。它通过在浏览器端无缝集成 GitLab、Jira、钉钉等核心办公平台，打破工具间的壁垒，实现 AI 能力的直达。

基于 Wegent AI 强大的大模型底座，本工具致力于赋能产研全流程。

## 安装使用（官方商店）

Chrome 应用商店

https://chromewebstore.google.com/detail/wegent-browser-power/ambidpbogbcdlephgniokkakghccheoi

## 安装使用（源代码编译）

确保 Node.js 版本 >= v24，并安装 pnpm。

### 克隆发布版本

```bash
git clone https://github.com/wecode-ai/wegent-browser-power.git
pnpm build
```

### 加载扩展到 Chrome

1. 打开 Chrome 浏览器，访问 `chrome://extensions/`
2. 在右上角启用"开发者模式"
3. 点击"加载已解压的扩展程序"按钮
4. 选择项目目录下的 `.output/chrome-mv3` 文件夹

### 更新扩展

直接拉取最新代码：

```bash
git pull
```

更新后刷新 Chrome 扩展页面即可使用最新版本。


## 推荐的 IDE 设置

- [VS Code](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar)

## 开发方式

### 前置要求

- Node.js 版本 >= v24
- pnpm

### 开始调试

1. 安装依赖：
   ```bash
   pnpm install
   ```

2. 启动开发服务器：
   ```bash
   pnpm dev
   ```

3. 在 Chrome 中加载扩展：
   - 打开 Chrome 浏览器，访问 `chrome://extensions/`
   - 在右上角启用"开发者模式"
   - 点击"加载已解压的扩展程序"按钮
   - 选择项目根目录下的 `.output/chrome-mv3-dev` 文件夹