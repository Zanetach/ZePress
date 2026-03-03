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

> ZePress 运行时不仅需要 `main.js` 和 `manifest.json`，还需要 `assets/` 与 `frontend/` 目录。
> 请使用完整插件包安装，不要只复制两个文件。

1. 从 [Releases](https://github.com/Zanetach/ZePress/releases) 页面下载最新的 `zepress.zip`
2. 在你的 Obsidian vault 目录下创建 `.obsidian/plugins/zepress/` 文件夹
3. 解压 `zepress.zip`，将其中全部文件复制到 `.obsidian/plugins/zepress/`（目录下应包含 `main.js`、`manifest.json`、`assets/`、`frontend/`）
4. 重启 Obsidian，在设置 → 社区插件中启用 "ZePress"

#### Migration（旧插件目录迁移）

如果你之前使用的是旧目录 `.obsidian/plugins/ze-publisher/`，请迁移到 `.obsidian/plugins/zepress/`，避免新旧插件 ID 混用导致资源路径异常。

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

# 4. 将完整构建产物复制到 Obsidian 插件目录
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
