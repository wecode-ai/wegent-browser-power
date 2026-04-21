# Wegent Browser Power

Wegent Browser Power is an embedded AI productivity plugin designed for developers and product managers. By seamlessly integrating core work platforms like GitLab, Jira, and DingTalk directly into the browser, it breaks down barriers between tools and delivers AI capabilities right where you work.

Powered by Wegent AI's advanced large language model, this tool aims to empower the entire product development and research workflow.

**English** | [中文](README.md)

## Installation (Official Store)

Chrome Web Store

https://chromewebstore.google.com/detail/wegent-browser-power/ambidpbogbcdlephgniokkakghccheoi

## Installation (Build from Source)

Ensure Node.js version >= v24 and pnpm is installed.

### Clone Release Version

```bash
git clone https://github.com/wecode-ai/wegent-browser-power.git
pnpm build
```

### Load Extension in Chrome

1. Open Chrome browser and visit `chrome://extensions/`
2. Enable "Developer mode" in the top right corner
3. Click "Load unpacked" button
4. Select the `.output/chrome-mv3` folder in the project directory

### Update Extension

Pull the latest code:

```bash
git pull
```

After updating, refresh the Chrome extensions page to use the latest version.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar)

## Development

### Prerequisites

- Node.js version >= v24
- pnpm

### Getting Started

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Start development server:
   ```bash
   pnpm dev
   ```

3. Load extension in Chrome:
   - Open Chrome browser and visit `chrome://extensions/`
   - Enable "Developer mode" in the top right corner
   - Click "Load unpacked" button
   - Select the `.output/chrome-mv3-dev` folder in the project root directory
