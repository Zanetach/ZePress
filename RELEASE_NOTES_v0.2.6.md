# ZePress v0.2.6 Release Notes

### 🌟 What's New & Fixed (更新与修复)

#### 1. 🎨 Theme & UI Fixes (主题与界面修复)
- **深色模式背景修复**: 修复了在 Obsidian 深色模式下，发布面板内（Shadow DOM）背景错误的显示为白色的问题。现在完全适配并继承深色主题，提供一致的沉浸式体验。

#### 2. 🧹 Repository & Codebase Cleanup (仓库与代码清理)
- **全面重命名为 ZePress**: 移除了代码内部、UI界面及配置清单中所有残留的 `lovpen` 名称，统一重命名为最新的 **ZePress**，保证品牌一致性。
- **项目结构精简**: 移除了多达 50+ 个无用的早期过渡文档、设计原稿、临时的 assets 图片和废弃配置文件，显著缩小了仓库体积。
- **`.gitignore` 文件增强**: 现在能正确拦截所有无需上传的编译产物目录（例如 `packages/*/dist` 和 `node_modules`），使得开发者 Clone 源码后更为清晰。

#### 3. 🛠️ Build & Usability Improvements (构建与可用性提升)
- **README 安装指南重构**: 针对新用户新增了详尽的安装步骤，涵盖：从 GitHub Release 安装、从源码自行构建安装、以及开发模式。
- **构建依赖健康度修复**: 移除了废弃的 assets 主题依赖，改为内置的回退方案。现在能够 100% 成功通过 TypeScript 类型安全检测和 `pnpm build` 命令，方便二次开发。

### 📦 Installation (安装说明)

您可以直接下载本页面下方的 **`zepress-0.2.6.zip`**，解压到您的 `.obsidian/plugins/zepress/` 目录下并重启 Obsidian 即可。或者直接下载 `main.js`, `manifest.json` 及 `styles.css` 放入该文件夹中。
