# ZePress

## Introduction

ZePress is an Obsidian publishing workflow plugin.  
It helps you format content, run AI-assisted operations, generate images, preview results in real time, and distribute content to external platforms in a unified workflow.

## Key Features

- Real-time article rendering and preview
- AI analysis and content operation panel
- Mermaid diagram rendering in content area
- Theme and template kit switching
- Content distribution settings for platforms such as WeChat, X (Twitter), and Zhihu
- Cover/image generation and save workflow

## Installation

### From GitHub Release

1. 从 [Releases](https://github.com/Zanetach/ZePress/releases) 页面下载最新的 `main.js`、`manifest.json`
2. 在你的 Obsidian vault 目录下创建 `.obsidian/plugins/zepress/` 文件夹
3. 将下载的文件复制到该文件夹
4. 重启 Obsidian，在设置 → 社区插件中启用 "ZePress"

### From Source（从源码构建）

**前置要求**: [Node.js](https://nodejs.org/) >= 16, [pnpm](https://pnpm.io/) >= 8

```bash
# 1. 克隆仓库
git clone https://github.com/Zanetach/ZePress.git
cd ZePress

# 2. 安装依赖
pnpm install

# 3. 构建插件
pnpm build

# 4. 将构建产物复制到 Obsidian 插件目录
# macOS/Linux:
mkdir -p /path/to/your/vault/.obsidian/plugins/zepress
cp -r packages/obsidian/dist/* /path/to/your/vault/.obsidian/plugins/zepress/

# Windows (PowerShell):
# Copy-Item -Recurse packages/obsidian/dist/* "$env:USERPROFILE/path/to/vault/.obsidian/plugins/zepress/"
```

5. 重启 Obsidian，在设置 → 社区插件中启用 "ZePress"

### Development（开发模式）

```bash
# 自动监听文件变化并同步到 Obsidian
pnpm dev
```

在 `.env.local` 中配置你的 vault 路径：

```env
OBSIDIAN_VAULT_PATH=/absolute/path/to/your/vault
```

## License

MIT
