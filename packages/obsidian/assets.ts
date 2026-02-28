import * as zip from "@zip.js/zip.js";
import {
	App,
	FileSystemAdapter,
	Notice,
	PluginManifest,
	requestUrl,
	TAbstractFile,
} from "obsidian";
import DefaultHighlight from "./default-highlight";
import DefaultTheme from "./default-theme";
import { logger } from "../shared/src/logger";
import { resolvePluginAssetsDir } from "./plugin-paths";

export interface Theme {
	name: string;
	className: string;
	desc: string;
	author: string;
	css: string;
}

export interface Highlight {
	name: string;
	url: string;
	css: string;
}

export default class AssetsManager {
	private static instance: AssetsManager;
	app: App;
	defaultTheme: Theme = DefaultTheme;
	manifest: PluginManifest;
	themes: Theme[];
	highlights: Highlight[];
	assetsPath: string;
	themesPath: string;
	hilightPath: string;
	customCSS: string = "";
	themeCfg: string;
	hilightCfg: string;
	customCSSPath: string;
	iconsPath: string;
	templatesPath: string;
	private assetsPathResolved = false;

	private constructor() { }

	// 静态方法，用于获取实例
	public static getInstance(): AssetsManager {
		if (!AssetsManager.instance) {
			AssetsManager.instance = new AssetsManager();
		}
		return AssetsManager.instance;
	}

	public static setup(app: App, manifest: PluginManifest) {
		AssetsManager.getInstance()._setup(app, manifest);
	}

	async loadAssets() {
		await this.loadThemes();
		await this.loadHighlights();
		await this.loadCustomCSS();
	}

	async loadThemes() {
		try {
			await this.ensureAssetsPathResolved();
			// 首先加载默认主题
			this.themes = [this.defaultTheme];

			// 加载其他主题配置
			if (!(await this.app.vault.adapter.exists(this.themeCfg))) {
				// 资源缺失时不直接报错阻塞，优先降级到默认主题
				logger.warn(
					`[AssetsManager] themes.json 不存在，使用默认主题: ${this.themeCfg}`,
				);
				return;
			}

			const data = await this.app.vault.adapter.read(this.themeCfg);
			if (data) {
				const themes = JSON.parse(data);
				await this.loadCSS(themes);
				this.themes.push(...themes);
			}
		} catch (error) {
			logger.error("Failed to parse themes.json:", error);
			new Notice("themes.json解析失败！");
		}
	}

	async loadCSS(themes: Theme[]) {
		try {
			for (const theme of themes) {
				const cssFile = this.themesPath + theme.className + ".css";
				const cssContent = await this.app.vault.adapter.read(cssFile);
				if (cssContent) {
					// 兼容 note-to-mp 主题：将其容器选择器映射到本项目容器
					theme.css = cssContent
						.replace(/\.(note-to-mp)\b/g, ".zepress")
						.replace(/#write\b/g, ".zepress");
				}
			}
		} catch (error) {
			logger.error("Failed to read CSS:", error);
			new Notice("读取CSS失败！");
		}
	}

	async loadCustomCSS() {
		try {
			if (!(await this.app.vault.adapter.exists(this.customCSSPath))) {
				return;
			}

			const cssContent = await this.app.vault.adapter.read(
				this.customCSSPath,
			);
			if (cssContent) {
				this.customCSS = cssContent;
			}
		} catch (error) {
			logger.error("Failed to read CSS:", error);
			new Notice("读取CSS失败！");
		}
	}

	async loadHighlights() {
		try {
			await this.ensureAssetsPathResolved();
			const defaultHighlight = {
				name: "默认",
				url: "",
				css: DefaultHighlight,
			};
			this.highlights = [defaultHighlight];
			if (!(await this.app.vault.adapter.exists(this.hilightCfg))) {
				// 高亮资源可选，不强制要求下载
				logger.debug("高亮资源未下载，使用默认高亮");
				return;
			}

			const data = await this.app.vault.adapter.read(this.hilightCfg);
			if (data) {
				const items = JSON.parse(data);
				for (const item of items) {
					const cssFile = this.hilightPath + item.name + ".css";
					// 检查文件是否存在，不存在则跳过
					if (!(await this.app.vault.adapter.exists(cssFile))) {
						logger.debug(`高亮CSS文件不存在，跳过: ${cssFile}`);
						continue;
					}
					const cssContent =
						await this.app.vault.adapter.read(cssFile);
					this.highlights.push({
						name: item.name,
						url: item.url,
						css: cssContent,
					});
				}
			}
		} catch (error) {
			logger.error("Failed to parse highlights.json:", error);
			// 不显示错误通知，允许继续使用默认高亮
		}
	}

	async loadIcon(name: string) {
		const icon = this.iconsPath + name + ".svg";
		if (!(await this.app.vault.adapter.exists(icon))) {
			return "";
		}
		const iconContent = await this.app.vault.adapter.read(icon);
		if (iconContent) {
			return iconContent;
		}
		return "";
	}

	getTheme(themeName: string) {
		for (const theme of this.themes) {
			if (theme.name === themeName || theme.className === themeName) {
				return theme;
			}
		}
		// 主题不存在时始终回退到默认主题，避免右侧预览变成“无主题”样式
		return this.defaultTheme;
	}

	getHighlight(highlightName: string) {
		for (const highlight of this.highlights) {
			if (highlight.name === highlightName) {
				return highlight;
			}
		}
	}

	getThemeURL() {
		return `https://github.com/Zanetach/ZePress-2026/releases/latest/download/assets.zip`;
	}

	private async ensureAssetsDirs() {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(this.assetsPath))) {
			await adapter.mkdir(this.assetsPath);
		}
		if (!(await adapter.exists(this.themesPath))) {
			await adapter.mkdir(this.themesPath);
		}
	}

	async downloadThemes() {
		new Notice("已关闭默认地址下载，请使用“在线下载主题”功能");
	}

	async downloadThemesFromUrl(url: string) {
		try {
			const targetUrl = (url || "").trim();
			if (!targetUrl) {
				new Notice("请输入主题下载链接");
				return;
			}
			const res = await requestUrl({ url: targetUrl, method: "GET" });
			const contentType = String(
				res.headers?.["content-type"] || "",
			).toLowerCase();
			const lowerUrl = targetUrl.toLowerCase();

			// ZIP 主题包
			if (lowerUrl.endsWith(".zip") || contentType.includes("zip")) {
				await this.unzip(new Blob([res.arrayBuffer]));
				await this.loadAssets();
				new Notice("主题包导入完成！");
				return;
			}

			// 单个 CSS 主题
			const cssText = res.text || "";
			if (cssText.trim().length === 0) {
				new Notice("链接内容为空，无法导入主题");
				return;
			}

			await this.ensureAssetsDirs();
			const className = `custom-${Date.now()}`;
			const themeName = `在线主题 ${className}`;
			const cssFilePath = `${this.themesPath}${className}.css`;
			await this.app.vault.adapter.write(cssFilePath, cssText);

			let themeConfig: Theme[] = [];
			if (await this.app.vault.adapter.exists(this.themeCfg)) {
				try {
					const raw = await this.app.vault.adapter.read(this.themeCfg);
					themeConfig = JSON.parse(raw || "[]");
				} catch {
					themeConfig = [];
				}
			}

			themeConfig.push({
				name: themeName,
				className,
				desc: `from ${targetUrl}`,
				author: "online-import",
				css: "",
			});
			await this.app.vault.adapter.write(
				this.themeCfg,
				JSON.stringify(themeConfig, null, 2),
			);
			await this.loadAssets();
			new Notice("在线主题导入完成！");
		} catch (error) {
			logger.error("Failed to download themes from url:", error);
			new Notice("在线导入主题失败，请检查链接是否可访问");
		}
	}

	async unzip(data: Blob) {
		const zipFileReader = new zip.BlobReader(data);
		const zipReader = new zip.ZipReader(zipFileReader);
		const entries = await zipReader.getEntries();

		if (!(await this.app.vault.adapter.exists(this.assetsPath))) {
			this.app.vault.adapter.mkdir(this.assetsPath);
		}

		for (const entry of entries) {
			if (entry.directory) {
				const dirPath = this.assetsPath + entry.filename;
				this.app.vault.adapter.mkdir(dirPath);
			} else {
				const filePath = this.assetsPath + entry.filename;
				const textWriter = new zip.TextWriter();
				if (entry.getData) {
					const data = await entry.getData(textWriter);
					await this.app.vault.adapter.write(filePath, data);
				}
			}
		}

		await zipReader.close();
	}

	async removeThemes() {
		try {
			const adapter = this.app.vault.adapter;
			if (await adapter.exists(this.themeCfg)) {
				await adapter.remove(this.themeCfg);
			}
			if (await adapter.exists(this.hilightCfg)) {
				await adapter.remove(this.hilightCfg);
			}
			if (await adapter.exists(this.themesPath)) {
				await adapter.rmdir(this.themesPath, true);
			}
			if (await adapter.exists(this.hilightPath)) {
				await adapter.rmdir(this.hilightPath, true);
			}
			await this.loadAssets();
			new Notice("清空完成！");
		} catch (error) {
			logger.error("Failed to remove themes:", error);
			new Notice("清空主题失败！");
		}
	}

	async openAssets() {
		const path = require("path");
		const adapter = this.app.vault.adapter as FileSystemAdapter;
		const vaultRoot = adapter.getBasePath();
		const assets = this.assetsPath;
		if (!(await adapter.exists(assets))) {
			await adapter.mkdir(assets);
		}
		const dst = path.join(vaultRoot, assets);
		const { shell } = require("electron");
		shell.openPath(dst);
	}

	searchFile(originPath: string): TAbstractFile | null {
		const resolvedPath = this.resolvePath(originPath);
		const vault = this.app.vault;
		const attachmentFolderPath = vault.config.attachmentFolderPath || "";
		let localPath = resolvedPath;
		let file = null;

		// 然后从根目录查找
		file = vault.getFileByPath(resolvedPath);
		if (file) {
			return file;
		}

		file = vault.getFileByPath(originPath);
		if (file) {
			return file;
		}

		// 先从附件文件夹查找
		if (attachmentFolderPath != "") {
			localPath = attachmentFolderPath + "/" + originPath;
			file = vault.getFileByPath(localPath);
			if (file) {
				return file;
			}

			localPath = attachmentFolderPath + "/" + resolvedPath;
			file = vault.getFileByPath(localPath);
			if (file) {
				return file;
			}
		}

		// 最后查找所有文件
		const files = vault.getAllLoadedFiles();
		for (let f of files) {
			if (f.path.includes(originPath)) {
				return f;
			}
		}

		return null;
	}

	resolvePath(relativePath: string): string {
		const basePath = this.getActiveFileDir();
		if (!relativePath.includes("/")) {
			return relativePath;
		}
		const stack = basePath.split("/");
		const parts = relativePath.split("/");

		stack.pop(); // Remove the current file name (or empty string)

		for (const part of parts) {
			if (part === ".") continue;
			if (part === "..") stack.pop();
			else stack.push(part);
		}
		return stack.join("/");
	}

	getActiveFileDir() {
		const af = this.app.workspace.getActiveFile();
		if (af == null) {
			return "";
		}
		const parts = af.path.split("/");
		parts.pop();
		if (parts.length == 0) {
			return "";
		}
		return parts.join("/");
	}

	private _setup(app: App, manifest: PluginManifest) {
		this.app = app;
		this.manifest = manifest;
		// 先用统一解析后的插件目录初始化；运行时会在 ensureAssetsPathResolved 自动校准
		this.assetsPath = `${resolvePluginAssetsDir(this.app, this.manifest?.id || "zepress")}/`;
		this.themesPath = this.assetsPath + "themes/";
		this.hilightPath = this.assetsPath + "highlights/";
		this.themeCfg = this.assetsPath + "themes.json";
		this.hilightCfg = this.assetsPath + "highlights.json";
		this.customCSSPath = this.assetsPath + "custom.css";
		this.iconsPath = this.assetsPath + "icons/";
		this.templatesPath = this.assetsPath + "templates/";
		this.assetsPathResolved = false;
	}

	private setAssetsBase(base: string) {
		this.assetsPath = base.endsWith("/") ? base : `${base}/`;
		this.themesPath = this.assetsPath + "themes/";
		this.hilightPath = this.assetsPath + "highlights/";
		this.themeCfg = this.assetsPath + "themes.json";
		this.hilightCfg = this.assetsPath + "highlights.json";
		this.customCSSPath = this.assetsPath + "custom.css";
		this.iconsPath = this.assetsPath + "icons/";
		this.templatesPath = this.assetsPath + "templates/";
	}

	private async ensureAssetsPathResolved(): Promise<void> {
		if (this.assetsPathResolved) return;
		const adapter = this.app.vault.adapter;

		if (await adapter.exists(this.themeCfg)) {
			this.assetsPathResolved = true;
			return;
		}

		const candidates = [
			this.manifest?.dir,
			this.manifest?.id,
			"zepress",
		].filter(Boolean) as string[];

		for (const dir of candidates) {
			const normalizedDir = String(dir).replace(/\/+$/, "");
			const base = normalizedDir.includes("/")
				? `${normalizedDir}/assets/`
				: `${this.app.vault.configDir}/plugins/${normalizedDir}/assets/`;
			if (await adapter.exists(`${base}themes.json`)) {
				this.setAssetsBase(base);
				this.assetsPathResolved = true;
				logger.info(`[AssetsManager] 资源路径已自动修正: ${base}`);
				return;
			}
		}

		try {
			const pluginsRoot = `${this.app.vault.configDir}/plugins`;
			if (await adapter.exists(pluginsRoot)) {
				const listed = await adapter.list(pluginsRoot);
				for (const dir of listed.folders || []) {
					const base = `${dir}/assets/`;
					if (await adapter.exists(`${base}themes.json`)) {
						this.setAssetsBase(base);
						this.assetsPathResolved = true;
						logger.info(
							`[AssetsManager] 资源路径扫描命中: ${base}`,
						);
						return;
					}
				}
			}
		} catch (e) {
			logger.warn("[AssetsManager] 自动扫描资源路径失败:", e);
		}
	}
}
