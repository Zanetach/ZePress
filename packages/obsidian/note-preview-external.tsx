import {
	EventRef,
	ItemView,
	MarkdownView,
	Notice,
	requestUrl,
	WorkspaceLeaf,
} from "obsidian";
import { FRONT_MATTER_REGEX, VIEW_TYPE_NOTE_PREVIEW } from "./constants";

import AssetsManager from "./assets";
import InlineCSS from "./inline-css";
import { CardDataManager } from "./html-plugins/code-blocks";
import { MDRendererCallback } from "./markdown-plugins/rehype-plugin";
import { LocalImageManager } from "./markdown-plugins/local-file";
import { MarkedParser } from "./markdown-plugins/parser";
import { UnifiedPluginManager } from "./shared/plugin/unified-plugin-system";
import { NMPSettings } from "./settings";
import TemplateManager from "./template-manager";
import { ReactAPIService } from "./services/ReactAPIService";
import { uevent } from "./utils";
import { resolvePluginDir } from "./plugin-paths";
import { persistentStorageService } from "@/services/persistentStorage";
import { wxAddDraft, wxGetToken, wxUploadImage } from "./weixin-api";
import { xCreateTweet, xUploadImage, XAuthConfig } from "./x-api";
import {
	logger,
	findScreenshotElement,
	applyCodeBlockScale,
} from "@zepress/shared";
import { domToPng } from "modern-screenshot";
import {
	ArticleInfo,
	ExternalReactLib,
	GlobalReactAPI,
	isValidArticleInfo,
	isValidPersonalInfo,
	isValidTemplateKitBasicInfo,
	PersonalInfo,
	PluginData,
	ReactComponentPropsWithCallbacks,
	ReactSettings,
} from "./types/react-api-types";
import { TemplateKitBasicInfo } from "./template-kit-types";

declare const __ZEPRESS_EMBEDDED_REACT_IIFE__: string;

export class NotePreviewExternal
	extends ItemView
	implements MDRendererCallback
{
	container: Element;
	settings: NMPSettings;
	assetsManager: AssetsManager;
	articleHTML: string;
	title: string;
	markedParser: MarkedParser;
	listeners: EventRef[];
	externalReactLib: ExternalReactLib | null = null;
	reactContainer: HTMLElement | null = null;
	toolbarArticleInfo: ArticleInfo | null = null; // 存储工具栏的基本信息
	isUpdatingFromToolbar: boolean = false; // 标志位，避免无限循环
	private reactAPIService: ReactAPIService;
	private cachedProps: ReactComponentPropsWithCallbacks | null = null; // 缓存props避免重复创建
	private lastArticleHTML: string = ""; // 缓存上次的文章HTML
	private lastCSSContent: string = ""; // 缓存上次的CSS内容
	private lastMarkdown: string = ""; // 缓存上次的Markdown内容
	private isProcessing: boolean = false; // 避免重复处理
	private lastProcessedMd: string = ""; // 上次完整处理的Markdown
	private cachedFullCSS: string = ""; // 缓存完整的CSS用于快速更新
	private pluginCache: Map<string, string> = new Map(); // 缓存插件处理结果
	private debounceTimer: NodeJS.Timeout | null = null; // 防抖定时器
	private readonly DEBOUNCE_DELAY = 200; // 防抖延迟（毫秒）
	private currentWidth: number = 0; // 当前容器宽度

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		// 获取主插件的设置实例，确保设置一致性
		this.settings = this.getPluginSettings();
		this.assetsManager = AssetsManager.getInstance();
		this.markedParser = new MarkedParser(this.app, this);
		this.reactAPIService = ReactAPIService.getInstance();

		// 插件系统已通过MarkedParser初始化，无需单独初始化
	}

	get currentTheme() {
		return this.settings.defaultStyle;
	}

	get currentHighlight() {
		return this.settings.defaultHighlight;
	}

	get workspace() {
		return this.app.workspace;
	}

	getViewType() {
		return VIEW_TYPE_NOTE_PREVIEW;
	}

	getIcon() {
		return "clipboard-paste";
	}

	getDisplayText() {
		return "笔记预览";
	}

	async onOpen() {
		// 确保React应用已加载
		await this.loadExternalReactApp();

		// 确保设置实例是最新的
		this.settings = this.getPluginSettings();

		await this.buildUI();

		// 先渲染初始内容和加载CSS
		await this.renderMarkdown();

		// CSS加载完成后，再添加事件监听器
		// 这样可以确保快速更新时CSS已经就绪
		this.listeners = [
			this.workspace.on("active-leaf-change", () => this.update()),
			// 监听编辑器内容变化 - 使用防抖处理
			this.workspace.on("editor-change", (editor) => {
				this.handleEditorChange();
			}),
			// 移除modify事件监听，避免重复触发
			// editor-change已经能够捕获编辑器中的所有输入变化
		];

		uevent("open");
	}

	async onClose() {
		// 清理防抖定时器
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}

		this.listeners.forEach((listener) => this.workspace.offref(listener));
		if (this.externalReactLib && this.reactContainer) {
			this.externalReactLib.unmount(this.reactContainer);
		}
		uevent("close");
	}

	async update() {
		LocalImageManager.getInstance().cleanup();
		CardDataManager.getInstance().cleanup();
		await this.renderMarkdown();
	}

	/**
	 * 处理编辑器内容变化 - 使用防抖
	 */
	private handleEditorChange() {
		// 清除之前的定时器
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}

		// 设置新的定时器
		this.debounceTimer = setTimeout(() => {
			this.processEditorChange();
		}, this.DEBOUNCE_DELAY);
	}

	/**
	 * 实际处理编辑器变化 - 单次完整渲染
	 */
	private async processEditorChange() {
		// 避免重复处理
		if (this.isProcessing) {
			return;
		}

		this.isProcessing = true;

		try {
			// 尝试从编辑器直接获取内容（更快）
			const activeView =
				this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!activeView || !activeView.editor) {
				this.isProcessing = false;
				return;
			}

			// 直接从编辑器获取内容（同步，非常快）
			const md = activeView.editor.getValue();

			// 如果内容没有变化，直接返回
			if (md === this.lastMarkdown) {
				this.isProcessing = false;
				return;
			}
			this.lastMarkdown = md;

			// 单次完整处理（包括插件）
			await this.processWithPluginsAsync(md);
		} catch (error) {
			logger.error("处理编辑器变化失败:", error);
		} finally {
			this.isProcessing = false;
		}
	}

	/**
	 * 异步处理插件和模板 - 优化版本
	 */
	private async processWithPluginsAsync(md: string): Promise<void> {
		// 如果这个Markdown已经完整处理过，跳过
		if (md === this.lastProcessedMd) {
			return;
		}

		try {
			const startTime = performance.now();

			// 生成缓存键（基于内容的哈希）
			// 注意：当插件设置改变时，缓存会被清除，所以这里只需要基于内容
			const cacheKey = md;

			// 检查缓存
			const cached = this.pluginCache.get(cacheKey);
			if (cached) {
				this.articleHTML = cached;
				this.lastProcessedMd = md;

				// 使用缓存结果更新DOM
				const domUpdater = (window as any).__zepressDOMUpdater;
				if (domUpdater && domUpdater.isReady()) {
					domUpdater.updateArticleHTML(this.articleHTML);
				}

				logger.debug(
					`[渲染] 使用缓存，耗时: ${(performance.now() - startTime).toFixed(2)}ms`,
				);
				return;
			}

			// 移除frontmatter
			let cleanMd = md;
			if (cleanMd.startsWith("---")) {
				cleanMd = cleanMd.replace(FRONT_MATTER_REGEX, "");
			}

			// 解析Markdown
			let articleHTML = await this.markedParser.parse(cleanMd);
			articleHTML = this.wrapArticleContent(articleHTML);

			// 应用插件处理
			const pluginManager = UnifiedPluginManager.getInstance();
			articleHTML = pluginManager.processContent(
				articleHTML,
				this.settings,
			);

			// 缓存结果（限制缓存大小为100，使用FIFO策略）
			if (this.pluginCache.size >= 100) {
				const firstKey = this.pluginCache.keys().next().value;
				this.pluginCache.delete(firstKey);
			}
			this.pluginCache.set(cacheKey, articleHTML);

			this.articleHTML = articleHTML;
			this.lastProcessedMd = md; // 标记已处理

			const endTime = performance.now();
			logger.debug(
				`[渲染] 处理耗时: ${(endTime - startTime).toFixed(2)}ms`,
			);

			// 直接更新DOM
			const domUpdater = (window as any).__zepressDOMUpdater;
			if (domUpdater && domUpdater.isReady()) {
				domUpdater.updateArticleHTML(this.articleHTML);
			}
		} catch (error) {
			logger.error("处理内容时出错:", error);
		}
	}

	async renderMarkdown() {
		// 强制刷新assets，确保CSS在渲染前准备好
		await this.assetsManager.loadAssets();

		// 缓存完整的CSS供快速更新使用
		this.cachedFullCSS = this.getCSS();

		this.articleHTML = await this.getArticleContent();

		// 首次渲染或主题变化时，使用完整更新
		// 编辑器变化时，使用domUpdater直接更新
		await this.updateExternalReactComponent();
	}

	async renderArticleOnly() {
		this.articleHTML = await this.getArticleContent();
		await this.updateExternalReactComponent();
	}

	async updateArticleContentOnly() {
		try {
			// 只更新文章内容，不重新初始化React组件
			const newArticleHTML = await this.getArticleContent();
			this.articleHTML = newArticleHTML;

			// 更新React组件的props但不重新触发onArticleInfoChange
			await this.updateExternalReactComponent();
		} catch (error) {
			logger.error("[updateArticleContentOnly] 更新文章内容失败:", error);
		}
	}

	async copyArticle(mode: string = "wechat") {
		console.log(
			"🎯 [NotePreview] copyArticle method called, mode:",
			mode,
			"type:",
			typeof mode,
		);
		console.log('🎯 [NotePreview] mode === "image":', mode === "image");
		console.log('🎯 [NotePreview] mode === "wechat":', mode === "wechat");
		logger.debug(
			"🔥 [DEBUG] copyArticle called, mode:",
			mode,
			"type:",
			typeof mode,
		);
		logger.debug('🔥 [DEBUG] mode === "image":', mode === "image");
		logger.debug('🔥 [DEBUG] mode === "wechat":', mode === "wechat");

		let content = await this.getArticleContent();

		// 根据不同模式处理内容
		console.log(
			"🎯 [NotePreview] About to enter switch statement, mode:",
			mode,
		);
		switch (mode) {
			case "wechat_publish":
				await this.publishToWechatDraft(content);
				break;
				case "x_publish": {
				const xCfg = this.settings.distributionConfig?.["twitter"] as
					| {
							enabled?: boolean;
							apiKey?: string;
							apiSecret?: string;
							accessToken?: string;
							accessTokenSecret?: string;
					  }
					| undefined;
					if (!xCfg?.enabled) {
						new Notice("请先在内容分发设置中启用 X 平台");
						throw new Error("X 平台未启用");
					}
				if (
					!xCfg.apiKey ||
					!xCfg.apiSecret ||
					!xCfg.accessToken ||
					!xCfg.accessTokenSecret
					) {
						new Notice("请先完善 X 平台参数并保存");
						throw new Error("X 平台参数不完整");
					}
					await this.publishToX(content, xCfg as any);
					break;
				}
			case "x": {
				const text = this.getXTextFromContent(content);
				await navigator.clipboard.writeText(text);
				new Notice("已复制 X 发布文本");
				break;
			}
			case "wechat":
				console.log("🎯 [NotePreview] Entered wechat case");
				logger.debug("🔥 [DEBUG] 进入 wechat case");
				// 微信公众号格式 - 处理代码块横向滚动问题
				// 微信会强制覆盖 white-space: pre 为 pre-wrap，需要用 HTML 结构处理
				{
					const tempContainer = document.createElement("div");
					tempContainer.innerHTML = content;
					this.preserveCodeSpacing(tempContainer);
					const processedContent = tempContainer.innerHTML;
					console.log(
						"[ZePress] Copied HTML for WeChat:",
						processedContent.substring(0, 500) + "...",
					);
					await navigator.clipboard.write([
						new ClipboardItem({
							"text/html": new Blob([processedContent], {
								type: "text/html",
							}),
						}),
					]);
				}
				new Notice(`已复制到剪贴板（微信公众号格式）！`);
				break;

			case "html":
				// 标准HTML格式
				await navigator.clipboard.write([
					new ClipboardItem({
						"text/html": new Blob([content], { type: "text/html" }),
					}),
				]);
				new Notice(`已复制到剪贴板（HTML格式）！`);
				break;

			case "image":
				console.log("🎯 [NotePreview] Entered image case");
				logger.debug("🔥 [DEBUG] 进入 image case");
				// 图片格式 - 使用 modern-screenshot 生成图片
				try {
					logger.debug("开始生成图片...");
					new Notice(`正在生成图片...`);

					// 使用共享的截图元素查找逻辑
					const result = findScreenshotElement(
						this.reactContainer || document,
					);
					if (!result) {
						logger.error("未找到任何可截图的元素");
						new Notice(`未找到文章内容，无法生成图片`);
						return;
					}

					const {
						element: articleElement,
						selector,
						includesTemplate,
					} = result;
					logger.debug(
						`使用选择器: ${selector}, 包含模板: ${includesTemplate}`,
					);

					// 先对原始元素截图
					logger.debug("开始截图...");

					// 预处理：将外部图片转换为 data URL 以避免 CORS 问题
					const images = articleElement.querySelectorAll("img");
					const imageData = new Map<
						HTMLImageElement,
						{ originalSrc: string; dataUrl?: string }
					>();

					// 使用 Obsidian 的 requestUrl 获取图片并转换为 data URL
					await Promise.all(
						Array.from(images).map(async (img) => {
							const src = img.src;
							imageData.set(img, { originalSrc: src });

							// 跳过已经是 data URL 的图片
							if (src.startsWith("data:")) {
								return;
							}

							try {
								logger.debug("正在加载图片:", src);
								// 使用 Obsidian 的 requestUrl，它可以绕过 CORS
								const response = await requestUrl({ url: src });

								// 转换为 data URL
								const blob = new Blob([response.arrayBuffer], {
									type:
										response.headers["content-type"] ||
										"image/png",
								});
								const dataUrl = await new Promise<string>(
									(resolve, reject) => {
										const reader = new FileReader();
										reader.onloadend = () =>
											resolve(reader.result as string);
										reader.onerror = reject;
										reader.readAsDataURL(blob);
									},
								);

								imageData.get(img)!.dataUrl = dataUrl;
								img.src = dataUrl;
								logger.debug("图片已转换为 data URL:", src);
							} catch (error) {
								logger.warn(
									"图片加载失败，将使用原始 URL:",
									src,
									error,
								);
								// 失败也继续，使用原始 URL
							}
						}),
					);

					logger.debug("所有图片预处理完成，开始截图");

					// 根据设置决定是否缩放溢出的代码块
					const shouldScaleCodeBlock =
						this.settings.scaleCodeBlockInImage ?? true;
					const codeBlockScale = shouldScaleCodeBlock
						? applyCodeBlockScale(articleElement)
						: null;

					const originalDataUrl = await domToPng(articleElement, {
						quality: 1,
						scale: 2, // 2倍分辨率，提高清晰度
					});

					// 恢复代码块原始样式
					codeBlockScale?.restore();
					logger.debug(
						"截图完成，dataUrl 长度:",
						originalDataUrl.length,
					);

					// 恢复原始图片 URL
					images.forEach((img) => {
						const data = imageData.get(img);
						if (data && data.dataUrl) {
							img.src = data.originalSrc;
						}
					});

					// 创建 Image 对象加载截图
					logger.debug("加载图片到 Image 对象...");
					const img = new Image();
					await new Promise<void>((resolve, reject) => {
						img.onload = () => {
							logger.debug(
								"图片加载成功，尺寸:",
								img.width,
								"x",
								img.height,
							);
							resolve();
						};
						img.onerror = (e) => {
							logger.error("图片加载失败:", e);
							reject(e);
						};
						img.src = originalDataUrl;
					});

					// 创建 Canvas 添加 padding
					const padding = 40 * 2; // 2倍分辨率，所以 padding 也要 x2
					const canvas = document.createElement("canvas");
					canvas.width = img.width + padding * 2;
					canvas.height = img.height + padding * 2;
					logger.debug(
						"创建 Canvas，尺寸:",
						canvas.width,
						"x",
						canvas.height,
					);

					const ctx = canvas.getContext("2d");
					if (!ctx) {
						throw new Error("无法创建 Canvas 上下文");
					}

					// 填充白色背景
					ctx.fillStyle = "#ffffff";
					ctx.fillRect(0, 0, canvas.width, canvas.height);

					// 绘制截图，添加 padding
					ctx.drawImage(img, padding, padding);
					logger.debug("绘制完成");

					// 转换为 data URL
					const dataUrl = canvas.toDataURL("image/png", 1.0);
					logger.debug("转换为 dataURL，长度:", dataUrl.length);

					// 将 data URL 转换为 Blob
					const response = await fetch(dataUrl);
					const blob = await response.blob();
					logger.debug("创建 Blob，大小:", blob.size, "字节");

					// 复制到剪贴板
					logger.debug("开始写入剪贴板...");
					await navigator.clipboard.write([
						new ClipboardItem({
							"image/png": blob,
						}),
					]);
					logger.debug("写入剪贴板成功");

					new Notice(`已复制图片到剪贴板！`);
					} catch (error) {
						logger.error("生成图片失败:", error);
						const errorMessage =
							error instanceof Error ? error.message : String(error);
						new Notice(`生成图片失败: ${errorMessage}`);
						throw new Error(errorMessage);
					}
					break;

			case "zhihu":
				// 知乎格式 - 目前使用HTML格式
				await navigator.clipboard.write([
					new ClipboardItem({
						"text/html": new Blob([content], { type: "text/html" }),
					}),
				]);
				new Notice(`已复制到剪贴板（知乎格式）！`);
				break;

			case "xiaohongshu":
				// 小红书格式 - 目前使用HTML格式
				await navigator.clipboard.write([
					new ClipboardItem({
						"text/html": new Blob([content], { type: "text/html" }),
					}),
				]);
				new Notice(`已复制到剪贴板（小红书格式）！`);
				break;

			default:
				// 默认使用微信格式
				await navigator.clipboard.write([
					new ClipboardItem({
						"text/html": new Blob([content], { type: "text/html" }),
					}),
				]);
				new Notice(`已复制到剪贴板！`);
		}
	}

	private getWechatPublishTitle(): string {
		const fromToolbar = this.toolbarArticleInfo?.articleTitle?.trim();
		if (fromToolbar) return fromToolbar;
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile?.basename) return activeFile.basename;
		return "未命名文章";
	}

	private htmlToPlainText(html: string): string {
		const temp = document.createElement("div");
		temp.innerHTML = html;
		return (temp.textContent || temp.innerText || "").replace(/\s+/g, " ").trim();
	}

	private getXTextFromContent(html: string): string {
		const title = this.getWechatPublishTitle();
		const plain = this.htmlToPlainText(html);
		const summary = plain.slice(0, 220);
		return `${title}\n\n${summary}`;
	}

	private splitForXThread(text: string, maxLen = 270): string[] {
		const normalized = text.replace(/\r\n/g, "\n").trim();
		if (!normalized) return [];
		const parts: string[] = [];
		let cursor = normalized;
		while (cursor.length > maxLen) {
			let idx = cursor.lastIndexOf("\n", maxLen);
			if (idx < 40) idx = cursor.lastIndexOf("。", maxLen);
			if (idx < 40) idx = cursor.lastIndexOf(" ", maxLen);
			if (idx < 40) idx = maxLen;
			parts.push(cursor.slice(0, idx).trim());
			cursor = cursor.slice(idx).trim();
		}
		if (cursor) parts.push(cursor);
		return parts.filter(Boolean);
	}

	private async getFirstImageBlobFromHtml(html: string): Promise<Blob | null> {
		try {
			const temp = document.createElement("div");
			temp.innerHTML = html;
			const firstImg = temp.querySelector("img");
			const src = firstImg?.getAttribute("src") || "";
			if (!src) return null;
			if (src.startsWith("http://") || src.startsWith("https://")) {
				const resp = await requestUrl({ url: src, method: "GET" });
				const contentType = resp.headers?.["content-type"] || "image/png";
				return new Blob([resp.arrayBuffer], { type: contentType });
			}
			const resp = await fetch(src);
			return await resp.blob();
		} catch (error) {
			logger.error("提取首图失败:", error);
			return null;
		}
	}

	private async publishToX(
		content: string,
		xCfg: {
			apiKey: string;
			apiSecret: string;
			accessToken: string;
			accessTokenSecret: string;
		},
	): Promise<void> {
		try {
			const auth: XAuthConfig = {
				apiKey: xCfg.apiKey,
				apiSecret: xCfg.apiSecret,
				accessToken: xCfg.accessToken,
				accessTokenSecret: xCfg.accessTokenSecret,
			};

			const text = this.getXTextFromContent(content);
			const segments = this.splitForXThread(text);
			if (!segments.length) {
				new Notice("内容为空，无法发布到 X");
				throw new Error("内容为空，无法发布到 X");
			}

			let mediaIds: string[] | undefined;
			const firstImageBlob = await this.getFirstImageBlobFromHtml(content);
			if (firstImageBlob) {
				const mediaRes = await xUploadImage(
					auth,
					firstImageBlob,
					`zepress-${Date.now()}.png`,
				);
				if (mediaRes.media_id_string) {
					mediaIds = [mediaRes.media_id_string];
				}
			}

			const first = await xCreateTweet(auth, segments[0], { mediaIds });
			if (!first.id) {
				const msg = `发布 X 失败：${first.error || "未知错误"}`;
				new Notice(msg);
				throw new Error(msg);
			}

			let parentId = first.id;
			for (let i = 1; i < segments.length; i++) {
				const reply = await xCreateTweet(auth, segments[i], {
					replyToId: parentId,
				});
				if (!reply.id) {
					const msg = `X 线程第 ${i + 1} 条发布失败：${reply.error || "未知错误"}`;
					new Notice(msg);
					throw new Error(msg);
				}
				parentId = reply.id;
			}

			const url = `https://x.com/i/web/status/${first.id}`;
			new Notice(
				segments.length > 1
					? `已发布到 X（线程 ${segments.length} 条）: ${url}`
					: `已发布到 X: ${url}`,
			);
		} catch (error) {
			logger.error("发布到 X 失败:", error);
			new Notice("发布到 X 失败，请检查参数与网络");
			throw error instanceof Error
				? error
				: new Error("发布到 X 失败，请检查参数与网络");
		}
	}

	private async getWechatThumbMediaIdFromContent(
		html: string,
		token: string,
	): Promise<string | null> {
		try {
			const temp = document.createElement("div");
			temp.innerHTML = html;
			const firstImg = temp.querySelector("img");
			const src = firstImg?.getAttribute("src") || "";
			if (!src) return null;

			let imgBlob: Blob;
			if (src.startsWith("http://") || src.startsWith("https://")) {
				const resp = await requestUrl({ url: src, method: "GET" });
				const contentType = resp.headers?.["content-type"] || "image/png";
				imgBlob = new Blob([resp.arrayBuffer], { type: contentType });
			} else {
				const resp = await fetch(src);
				imgBlob = await resp.blob();
			}

			const uploadResult = await wxUploadImage(
				imgBlob,
				`cover-${Date.now()}.png`,
				token,
				"image",
			);
			if (uploadResult?.media_id) return uploadResult.media_id;
			return null;
		} catch (error) {
			logger.error("获取封面 media_id 失败:", error);
			return null;
		}
	}

	private async publishToWechatDraft(content: string): Promise<void> {
		try {
			const wxAccounts = this.settings.wxInfo || [];
			if (!wxAccounts.length) {
				new Notice("未配置微信公众号参数，请先在内容分发设置中配置");
				throw new Error("未配置微信公众号参数");
			}
			if (!this.settings.authKey) {
				new Notice("未配置 AuthKey，无法发布到公众号");
				throw new Error("未配置 AuthKey");
			}

			const account = wxAccounts[0];
			const tokenRes = await wxGetToken(
				this.settings.authKey,
				account.appid,
				account.secret,
			);
			const tokenData = await tokenRes.json;
			const token = tokenData?.access_token || "";
			if (!token) {
				new Notice(`获取公众号 token 失败：${tokenData?.errmsg || "未知错误"}`);
				throw new Error(
					`获取公众号 token 失败：${tokenData?.errmsg || "未知错误"}`,
				);
			}

			const tempContainer = document.createElement("div");
			tempContainer.innerHTML = content;
			this.preserveCodeSpacing(tempContainer);
			const processedContent = tempContainer.innerHTML;

			const title = this.getWechatPublishTitle();
			const digest =
				this.toolbarArticleInfo?.summary?.trim() ||
				this.htmlToPlainText(processedContent).slice(0, 120);
			const thumbMediaId = await this.getWechatThumbMediaIdFromContent(
				processedContent,
				token,
			);
			if (!thumbMediaId) {
				new Notice("未找到可用封面图片，请先在文章中插入图片后再发布");
				throw new Error("未找到可用封面图片");
			}

			const draftRes = await wxAddDraft(token, {
				title,
				author: this.toolbarArticleInfo?.author || undefined,
				digest,
				content: processedContent,
				thumb_media_id: thumbMediaId,
			});
			const draftData = await draftRes.json;
			if (draftData?.errcode && draftData.errcode !== 0) {
				new Notice(`发布失败：${draftData.errmsg || "未知错误"}`);
				throw new Error(`发布失败：${draftData.errmsg || "未知错误"}`);
			}
			new Notice("已发布到微信公众号草稿箱");
		} catch (error) {
			logger.error("发布到微信公众号失败:", error);
			new Notice("发布到微信公众号失败，请检查配置与网络");
			throw error instanceof Error
				? error
				: new Error("发布到微信公众号失败，请检查配置与网络");
		}
	}

	/**
	 * 处理代码块格式，用于微信公众号导出
	 * 微信会强制覆盖 white-space: pre 为 pre-wrap，导致代码自动换行
	 * 解决方案：用 HTML 结构代替 CSS 行为
	 */
	private preserveCodeSpacing(container: HTMLElement): void {
		container.querySelectorAll("pre").forEach((pre) => {
			const preEl = pre as HTMLElement;
			// 不依赖 white-space，微信会强制覆盖
			preEl.style.overflow = "auto";
			preEl.style.overflowWrap = "normal";
			preEl.style.wordBreak = "normal";
		});

		container.querySelectorAll("pre code").forEach((code) => {
			const codeEl = code as HTMLElement;

			// 收集所有内容，按行重建，用 <br> 换行
			const lines = this.extractCodeLines(codeEl);
			codeEl.innerHTML = "";

			lines.forEach((lineNodes, idx) => {
				// 每行用 span 包裹，nowrap 防止断行
				const lineSpan = document.createElement("span");
				lineSpan.style.display = "inline";
				lineSpan.style.whiteSpace = "nowrap";

				lineNodes.forEach((node) => lineSpan.appendChild(node));
				codeEl.appendChild(lineSpan);

				// 除了最后一行，都加 <br>
				if (idx < lines.length - 1) {
					codeEl.appendChild(document.createElement("br"));
				}
			});
		});
	}

	/**
	 * 提取 code 元素的内容，按换行符拆分成行
	 * 每行是一个 Node 数组（保留 span 高亮）
	 */
	private extractCodeLines(codeEl: HTMLElement): Node[][] {
		const lines: Node[][] = [[]];

		const processNode = (node: Node): void => {
			if (node.nodeType === Node.TEXT_NODE) {
				const text = node.textContent ?? "";
				const parts = text.split("\n");

				parts.forEach((part, i) => {
					if (i > 0) lines.push([]); // 换行，开启新行

					if (part) {
						// 空格转 &nbsp;，tab 转 4 空格
						const converted = part
							.replace(/\t/g, "\u00a0\u00a0\u00a0\u00a0")
							.replace(/ /g, "\u00a0");
						lines[lines.length - 1].push(
							document.createTextNode(converted),
						);
					}
				});
			} else if (node.nodeType === Node.ELEMENT_NODE) {
				const el = node as HTMLElement;
				// 克隆元素但不克隆子节点
				const clone = el.cloneNode(false) as HTMLElement;
				// 内联样式
				const style = getComputedStyle(el);
				if (style.color) clone.style.color = style.color;
				if (style.fontWeight) clone.style.fontWeight = style.fontWeight;
				if (style.fontStyle && style.fontStyle !== "normal")
					clone.style.fontStyle = style.fontStyle;

				// 递归处理子节点
				const childLines: Node[][] = [[]];
				el.childNodes.forEach((child) => {
					const subLines = this.extractLinesFromNode(child);

					subLines.forEach((subLine, i) => {
						if (i > 0) childLines.push([]);
						childLines[childLines.length - 1].push(...subLine);
					});
				});

				// 把子节点的行合并回来
				childLines.forEach((childLine, i) => {
					if (i > 0) lines.push([]);
					if (childLine.length > 0) {
						const wrapper = clone.cloneNode(false) as HTMLElement;
						childLine.forEach((n) => wrapper.appendChild(n));
						lines[lines.length - 1].push(wrapper);
					}
				});
			}
		};

		codeEl.childNodes.forEach((child) => processNode(child));
		return lines;
	}

	private extractLinesFromNode(node: Node): Node[][] {
		const lines: Node[][] = [[]];

		if (node.nodeType === Node.TEXT_NODE) {
			const text = node.textContent ?? "";
			const parts = text.split("\n");

			parts.forEach((part, i) => {
				if (i > 0) lines.push([]);
				if (part) {
					const converted = part
						.replace(/\t/g, "\u00a0\u00a0\u00a0\u00a0")
						.replace(/ /g, "\u00a0");
					lines[lines.length - 1].push(
						document.createTextNode(converted),
					);
				}
			});
		} else if (node.nodeType === Node.ELEMENT_NODE) {
			const el = node as HTMLElement;
			const clone = el.cloneNode(false) as HTMLElement;
			const style = getComputedStyle(el);
			if (style.color) clone.style.color = style.color;
			if (style.fontWeight) clone.style.fontWeight = style.fontWeight;
			if (style.fontStyle && style.fontStyle !== "normal")
				clone.style.fontStyle = style.fontStyle;

			const childLines: Node[][] = [[]];
			el.childNodes.forEach((child) => {
				const subLines = this.extractLinesFromNode(child);
				subLines.forEach((subLine, i) => {
					if (i > 0) childLines.push([]);
					childLines[childLines.length - 1].push(...subLine);
				});
			});

			childLines.forEach((childLine, i) => {
				if (i > 0) lines.push([]);
				if (childLine.length > 0) {
					const wrapper = clone.cloneNode(false) as HTMLElement;
					childLine.forEach((n) => wrapper.appendChild(n));
					lines[lines.length - 1].push(wrapper);
				}
			});
		}

		return lines;
	}

	updateCSSVariables() {
		// 在React组件中处理CSS变量更新
		// 首先尝试在React容器中查找
		let noteContainer = this.reactContainer?.querySelector(
			".zepress",
		) as HTMLElement;

		// 如果React容器中没有找到，则在整个document中查找
		if (!noteContainer) {
			noteContainer = document.querySelector(".zepress") as HTMLElement;
		}

		if (!noteContainer) {
			logger.warn("找不到容器，无法更新CSS变量");
			return;
		}

		if (this.settings.enableThemeColor) {
			noteContainer.style.setProperty(
				"--primary-color",
				this.settings.themeColor || "#7852ee",
			);
		} else {
			noteContainer.style.removeProperty("--primary-color");
		}

		const listItems = noteContainer.querySelectorAll("li");
		listItems.forEach((item) => {
			(item as HTMLElement).style.display = "list-item";
		});

		// 强制触发重绘，确保CSS变更立即生效
		noteContainer.style.display = "none";
		noteContainer.offsetHeight; // 触发重排
		noteContainer.style.display = "";
	}

	wrapArticleContent(article: string): string {
		let className = "zepress";

		// 如果设置了隐藏一级标题，移除第一个 h1 标签
		let processedArticle = article;
		if (this.settings.hideFirstHeading) {
			processedArticle = processedArticle.replace(
				/<h1[^>]*>[\s\S]*?<\/h1>/,
				"",
			);
		}

		let html = `<section class="${className}" id="article-section">${processedArticle}</section>`;

		if (this.settings.useTemplate) {
			try {
				const templateManager = TemplateManager.getInstance();
				const file = this.app.workspace.getActiveFile();
				const meta: Record<
					string,
					string | string[] | number | boolean | object | undefined
				> = {};

				// 首先获取frontmatter
				if (file) {
					const metadata = this.app.metadataCache.getFileCache(file);
					Object.assign(meta, metadata?.frontmatter);
				}

				// 设置文章标题的优先级：基本信息 > frontmatter
				// 如果隐藏一级标题，则不设置 articleTitle（模板也不渲染）
				if (this.settings.hideFirstHeading) {
					meta.articleTitle = "";
				} else {
					let finalTitle = "";
					if (
						this.toolbarArticleInfo?.articleTitle &&
						this.toolbarArticleInfo.articleTitle.trim() !== ""
					) {
						// 优先级1: 基本信息中的标题
						finalTitle =
							this.toolbarArticleInfo.articleTitle.trim();
					} else if (
						meta.articleTitle &&
						String(meta.articleTitle).trim() !== ""
					) {
						// 优先级2: frontmatter中的标题
						finalTitle = String(meta.articleTitle).trim();
					}

					// 设置最终的标题
					if (finalTitle) {
						meta.articleTitle = finalTitle;
					}
				}

				// 设置作者的优先级：基本信息 > frontmatter
				// 如果用户在基本信息中清空了作者，则不应该回退到storage
				let finalAuthor = "";
				if (
					this.toolbarArticleInfo &&
					"author" in this.toolbarArticleInfo
				) {
					// 如果基本信息存在author字段（即使为空），则使用它
					finalAuthor = this.toolbarArticleInfo.author?.trim() || "";
				} else if (meta.author && String(meta.author).trim() !== "") {
					// 只有在基本信息没有author字段时，才使用frontmatter
					finalAuthor = String(meta.author).trim();
				}

				// 设置最终的作者（可能为空）
				meta.author = finalAuthor;

				// 设置发布日期的优先级：基本信息 > frontmatter
				// 如果用户在基本信息中清空了日期，则不应该回退到当前日期
				let finalPublishDate = "";
				if (
					this.toolbarArticleInfo &&
					"publishDate" in this.toolbarArticleInfo
				) {
					// 如果基本信息存在publishDate字段（即使为空），则使用它
					finalPublishDate =
						this.toolbarArticleInfo.publishDate?.trim() || "";
				} else if (
					meta.publishDate &&
					String(meta.publishDate).trim() !== ""
				) {
					// 只有在基本信息没有publishDate字段时，才使用frontmatter
					finalPublishDate = String(meta.publishDate).trim();
				}

				// 设置最终的发布日期（可能为空）
				meta.publishDate = finalPublishDate;

				// 然后用工具栏的基本信息覆盖frontmatter（除了articleTitle、author、publishDate已经特殊处理）
				if (this.toolbarArticleInfo) {
					// 只覆盖有值的字段
					Object.keys(this.toolbarArticleInfo).forEach((key) => {
						// articleTitle、author、publishDate已经在上面特殊处理了，跳过
						if (
							key === "articleTitle" ||
							key === "author" ||
							key === "publishDate"
						)
							return;

						const value = this.toolbarArticleInfo![key];
						if (
							value !== undefined &&
							value !== null &&
							value !== ""
						) {
							// 对于数组类型的tags，需要特殊处理
							if (
								key === "tags" &&
								Array.isArray(value) &&
								value.length > 0
							) {
								meta[key] = value;
							} else if (key !== "tags" && value !== "") {
								meta[key] = value;
							}
						}
					});
				}

				// Add personalInfo to template data
				// 优先使用 toolbarArticleInfo.authorAvatar，其次使用 settings.personalInfo.avatar
				const avatarConfig =
					this.toolbarArticleInfo?.authorAvatar ||
					this.settings.personalInfo?.avatar;
				// 将 AvatarConfig 对象转换为字符串 URL（模板期望的格式）
				const avatarUrl =
					avatarConfig?.type === "uploaded" && avatarConfig?.data
						? avatarConfig.data
						: "";

				meta.personalInfo = {
					name: this.settings.personalInfo?.name || "",
					avatar: avatarUrl,
					bio: this.settings.personalInfo?.bio || "",
					email: this.settings.personalInfo?.email || "",
					website: this.settings.personalInfo?.website || "",
				};

				html = templateManager.applyTemplate(
					html,
					this.settings.defaultTemplate,
					meta,
				);
			} catch (error) {
				logger.error("应用模板失败", error);
				new Notice("应用模板失败，请检查模板设置！");
			}
		}

		return html;
	}

	async getArticleContent() {
		try {
			const af = this.app.workspace.getActiveFile();
			let md = "";
			if (af && af.extension.toLocaleLowerCase() === "md") {
				md = await this.app.vault.adapter.read(af.path);
				this.title = af.basename;
			} else {
				md = "没有可渲染的笔记或文件不支持渲染";
			}

			if (md.startsWith("---")) {
				md = md.replace(FRONT_MATTER_REGEX, "");
			}

			let articleHTML = await this.markedParser.parse(md);
			articleHTML = this.wrapArticleContent(articleHTML);

			const pluginManager = UnifiedPluginManager.getInstance();
			articleHTML = pluginManager.processContent(
				articleHTML,
				this.settings,
			);

			return articleHTML;
		} catch (error) {
			logger.error("获取文章内容时出错:", error);
			return `<div class="error-message">渲染内容时出错: ${error.message}</div>`;
		}
	}

	getCSS() {
		const theme = this.assetsManager.getTheme(this.currentTheme);
		const highlight = this.assetsManager.getHighlight(
			this.currentHighlight,
		);
		const customCSS = this.settings.useCustomCss
			? this.assetsManager.customCSS
			: "";

		let themeColorCSS = "";

		if (this.settings.enableThemeColor) {
			themeColorCSS = `
:root {
  --primary-color: ${this.settings.themeColor || "#7852ee"};
  --theme-color-light: ${this.settings.themeColor || "#7852ee"}aa;
}
`;
		}

		const highlightCss = highlight?.css || "";
		const themeCss = theme?.css || "";

		return `${themeColorCSS}

${InlineCSS}

${highlightCss}

${themeCss}

${customCSS}`;
	}

	updateElementByID(id: string, html: string): void {
		const el = document.getElementById(id);
		if (el) {
			el.innerHTML = html;
		}
	}

	openDistributionModal(): void {
		// todo: 在React组件中实现分发对话框
	}

	// Shadow DOM 相关属性
	private shadowRoot: ShadowRoot | null = null;
	private isMounted: boolean = false;
	// 🔑 启用 Shadow DOM 实现样式隔离，确保 Obsidian 端效果与 Web 端一致
	private readonly USE_SHADOW_DOM = true;

	async buildUI() {
		const viewContent =
			(this.contentEl as HTMLElement) ||
			(this.containerEl.querySelector(".view-content") as HTMLElement) ||
			(this.containerEl.children[1] as HTMLElement) ||
			this.containerEl;
		this.container = viewContent;
		this.container.empty();

		// 强制建立稳定的高度链路，避免长文被父容器裁切
		if (this.containerEl instanceof HTMLElement) {
			this.containerEl.style.height = "100%";
			this.containerEl.style.minHeight = "0";
			this.containerEl.style.display = "flex";
			this.containerEl.style.flexDirection = "column";
		}
		if (this.container instanceof HTMLElement) {
			this.container.style.flex = "1";
			this.container.style.height = "100%";
			this.container.style.minHeight = "0";
			this.container.style.display = "flex";
			this.container.style.overflow = "hidden";
		}

		console.log("[ZePress] buildUI() 开始");

		// 创建 React 容器
		this.reactContainer = document.createElement("div");
		this.reactContainer.style.width = "100%";
		this.reactContainer.style.height = "100%";
		this.reactContainer.style.minHeight = "0";
		this.reactContainer.style.display = "flex";
		this.reactContainer.style.overflow = "hidden";
		this.reactContainer.id = "zepress-react-container";
		this.container.appendChild(this.reactContainer);

		if (this.USE_SHADOW_DOM) {
			console.log("[ZePress] 启用 Shadow DOM 模式");
			logger.info("[Shadow DOM] 启用 Shadow DOM 模式");

			// 🔑 创建 Shadow Root 实现样式隔离
			this.shadowRoot = this.reactContainer.attachShadow({
				mode: "open",
			});

			// 🔑 Shadow Root 创建后立即注入 CSS
			await this.injectCSSToShadowRoot();
		} else {
			console.log("[ZePress] 禁用 Shadow DOM 模式，使用传统渲染");
			logger.info("[Shadow DOM] 禁用 Shadow DOM 模式，使用传统渲染");

			// 传统模式：添加 Obsidian 环境类
			this.reactContainer.classList.add("zepress-env");
			this.shadowRoot = null;

			// 传统模式下，如果是生产环境，需要加载 CSS 到 document.head
			if (!(window as any).__ZEPUBLISH_HMR_MODE__) {
				await this.loadExternalCSSToHead();
			}
			// HMR 模式下，Vite 会自动将 CSS 注入到 document.head
		}

		// 重置挂载状态
		this.isMounted = false;

		console.log(
			"[ZePress] buildUI() 即将调用 updateExternalReactComponent",
		);

		// 渲染外部React组件
		await this.updateExternalReactComponent();

		console.log("[ZePress] buildUI() 完成");
	}

	/**
	 * 将 CSS 注入到 Shadow Root
	 * 根据运行模式（HMR/Production）选择不同的加载方式
	 */
	private async injectCSSToShadowRoot(): Promise<void> {
		if (!this.shadowRoot) {
			logger.warn("Shadow Root 不存在，无法注入 CSS");
			return;
		}

		if ((window as any).__ZEPUBLISH_HMR_MODE__) {
			// HMR 模式：从 Vite dev server 获取 CSS
			const viteDevServerUrl = (window as any).__ZEPUBLISH_HMR_URL__ || "http://localhost:5173";
			await this.loadHMRCSSToShadowRoot(viteDevServerUrl);
		} else {
			// 生产模式：从插件目录加载打包的 CSS
			const pluginDir = resolvePluginDir(this.app);
			if (pluginDir) {
				await this.loadExternalCSS(pluginDir);
			}
		}
	}

	private getPluginSettings(): NMPSettings {
		const plugin =
			(this.app as any).plugins.plugins["zepress"] ||
			(this.app as any).plugins.plugins["zepress"];
		if (plugin && plugin.settings) {
			return plugin.settings;
		}

		// 如果主插件尚未加载，使用单例模式
		logger.warn("主插件尚未加载，使用单例模式");
		return NMPSettings.getInstance();
	}

	private async loadExternalReactApp() {
		try {
			// Always try HMR first in development
			const viteDevServerUrl = "http://localhost:5173";

			// Try to load from Vite dev server first
			try {
				// Check if dev server is running with a simple ping
				const response = await fetch(
					`${viteDevServerUrl}/@vite/client`,
					{
						method: "HEAD",
						mode: "cors",
					},
				);

				if (response.ok || response.status === 200) {
					// Clear any previous scripts to ensure fresh load
					const existingScripts = document.querySelectorAll(
						"script[data-zepress-hmr]",
					);
					existingScripts.forEach((s) => s.remove());

					// Load Vite client for HMR
					const viteClientScript = document.createElement("script");
					viteClientScript.type = "module";
					viteClientScript.src = `${viteDevServerUrl}/@vite/client`;
					viteClientScript.setAttribute("data-zepress-hmr", "true");
					document.head.appendChild(viteClientScript);

					// Load React refresh runtime
					const reactRefreshScript = document.createElement("script");
					reactRefreshScript.type = "module";
					reactRefreshScript.innerHTML = `
						import RefreshRuntime from '${viteDevServerUrl}/@react-refresh';
						RefreshRuntime.injectIntoGlobalHook(window);
						window.$RefreshReg$ = () => {};
						window.$RefreshSig$ = () => (type) => type;
						window.__vite_plugin_react_preamble_installed__ = true;
					`;
					reactRefreshScript.setAttribute(
						"data-zepress-hmr",
						"true",
					);
					document.head.appendChild(reactRefreshScript);

					// Load the dev module with timestamp to bypass cache
					const moduleScript = document.createElement("script");
					moduleScript.type = "module";
					moduleScript.src = `${viteDevServerUrl}/src/dev.tsx?t=${Date.now()}`;
					moduleScript.setAttribute("data-zepress-hmr", "true");
					document.head.appendChild(moduleScript);

					// Mark HMR mode
					(window as any).__ZEPUBLISH_HMR_MODE__ = true;
					(window as any).__ZEPUBLISH_HMR_URL__ = viteDevServerUrl;
					// Wait for the library to be available
					await new Promise<void>((resolve) => {
						let attempts = 0;
						const checkInterval = setInterval(() => {
							if (
								(window as any).ZePressReactLib ||
								attempts > 50
							) {
								clearInterval(checkInterval);
								resolve();
							}
							attempts++;
						}, 100);
					});

					this.externalReactLib = (window as any).ZePressReactLib;

					if (this.externalReactLib) {
						logger.info(
							"[HMR] ✅ Successfully loaded React app with HMR support",
						);
						this.setupGlobalAPI();

						// CSS 将在 buildUI() 中通过 injectCSSToShadowRoot() 注入

						// Setup HMR update listener
						this.setupHMRListener();
						return;
					}
				}
			} catch (devError) {}

			// Fall back to bundled version (production mode or dev server not available)
			const adapter = this.app.vault.adapter;
			const pluginDir = resolvePluginDir(this.app);
			const scriptPath = `${pluginDir}/frontend/zepress-react.iife.js`;

			let scriptContent = "";
			try {
				scriptContent = await adapter.read(scriptPath);
			} catch (fileError) {
				logger.warn(
					`读取外部 React 脚本失败，尝试使用内嵌回退: ${scriptPath}`,
					fileError?.message || fileError,
				);
				scriptContent = __ZEPRESS_EMBEDDED_REACT_IIFE__ || "";
			}
			if (!scriptContent || !scriptContent.trim()) {
				throw new Error(
					"未找到可用的 React bundle（frontend 文件缺失且无内嵌回退）",
				);
			}

			// 创建script标签并执行
			const script = document.createElement("script");
			script.textContent = scriptContent;
			document.head.appendChild(script);

			// CSS 将在 buildUI() 中通过 injectCSSToShadowRoot() 注入

			// 获取全局对象
			this.externalReactLib =
				(window as any).ZePressReactLib ||
				(window as any).ZePressReact ||
				(window as any).ZePressReact?.default ||
				(window as any).zepressReact;

			if (this.externalReactLib) {
				logger.debug("外部React应用加载成功（打包版本）", {
					availableMethods: Object.keys(this.externalReactLib),
					hasMount: typeof this.externalReactLib.mount === "function",
					hasUpdate:
						typeof this.externalReactLib.update === "function",
					hasUnmount:
						typeof this.externalReactLib.unmount === "function",
					actualObject: this.externalReactLib,
					windowZePressReact: (window as any).ZePressReact,
					windowZePressReactDefault: (window as any).ZePressReact
						?.default,
				});

				// 立即设置全局API，确保React组件可以访问
				this.setupGlobalAPI();
			} else {
				logger.error("找不到外部React应用的全局对象", {
					windowKeys: Object.keys(window).filter(
						(key) =>
							key.includes("Omni") ||
							key.includes("React") ||
							key.includes("react"),
					),
					zepressReact: !!(window as any).ZePressReact,
					zepressReactLib: !!(window as any).ZePressReactLib,
					zepressReactLowerCase:
						!!(window as any).zepressReact,
				});
			}
		} catch (error) {
			logger.error("加载外部React应用失败:", error);
			this.loadFallbackComponent();
		}
	}

	/**
	 * HMR 模式下加载 CSS 到 Shadow Root
	 * 🔑 从 window.__ZEPUBLISH_COMPILED_CSS__ 获取 Vite 编译后的 CSS
	 * 这样可以获取到完整的 TailwindCSS 编译结果，而不是原始的 @tailwind 指令
	 */
	private async loadHMRCSSToShadowRoot(
		_viteDevServerUrl: string,
	): Promise<void> {
		if (!this.shadowRoot) {
			console.warn("[ZePress][HMR] Shadow Root 不存在，无法注入 CSS");
			logger.warn("[HMR] Shadow Root 不存在，无法注入 CSS");
			return;
		}

		try {
			// 🔑 从 window 获取 Vite 编译后的 CSS
			const compiledCSS = (window as any).__ZEPUBLISH_COMPILED_CSS__;

			if (!compiledCSS) {
				console.warn("[ZePress][HMR] 编译后的 CSS 尚未加载，等待...");
				// 等待 CSS 加载完成（最多等待 5 秒）
				let attempts = 0;
				while (
					!(window as any).__ZEPUBLISH_COMPILED_CSS__ &&
					attempts < 50
				) {
					await new Promise((resolve) => setTimeout(resolve, 100));
					attempts++;
				}

				const css = (window as any).__ZEPUBLISH_COMPILED_CSS__;
				if (!css) {
					console.error("[ZePress][HMR] CSS 加载超时");
					logger.error("[HMR] CSS 加载超时");
					return;
				}
			}

			const cssText = (window as any).__ZEPUBLISH_COMPILED_CSS__;
			console.log(
				"[ZePress][HMR] 获取到编译后的 CSS，长度:",
				cssText.length,
			);

			// 检查是否已存在 HMR CSS
			const existingStyle = this.shadowRoot.querySelector(
				"style[data-zepress-hmr-css]",
			);
			if (existingStyle) {
				existingStyle.textContent = cssText;
				console.log("[ZePress][HMR] 已更新现有 CSS");
			} else {
				const style = document.createElement("style");
				style.setAttribute("data-zepress-hmr-css", "true");
				style.textContent = cssText;
				this.shadowRoot.appendChild(style);
				console.log("[ZePress][HMR] 已注入新 CSS 到 Shadow Root");
			}

			console.log("[ZePress][HMR] ✅ CSS 注入完成");
			logger.info("[HMR] ✅ CSS 已注入到 Shadow Root");
		} catch (error) {
			console.error("[ZePress][HMR] 加载 CSS 失败:", error);
			logger.warn("[HMR] 加载 CSS 失败:", error);
		}
	}

	private async loadExternalCSS(pluginDir: string) {
		try {
			// Check if we're in HMR mode - CSS is handled by loadHMRCSSToShadowRoot
			if ((window as any).__ZEPUBLISH_HMR_MODE__) {
				logger.debug("[HMR] CSS 已通过 loadHMRCSSToShadowRoot 管理");
				return;
			}

			if (!this.shadowRoot) {
				logger.warn("Shadow Root 不存在，无法注入 CSS");
				return;
			}

			const adapter = this.app.vault.adapter;
			let cssPath = `${pluginDir}/frontend/style.css`;
			let cssContent = "";
			try {
				cssContent = await adapter.read(cssPath);
			} catch {
				cssPath = `${pluginDir}/styles.css`;
				cssContent = await adapter.read(cssPath);
			}

			// 🔑 将 CSS 注入到 Shadow Root 内，而不是 document.head
			// 检查是否已经有这个CSS
			const existingStyle = this.shadowRoot.querySelector(
				"style[data-zepress-react]",
			);
			if (existingStyle) {
				existingStyle.remove();
			}

			// 创建style标签并插入CSS到Shadow Root
			const style = document.createElement("style");
			style.setAttribute("data-zepress-react", "true");
			style.textContent = cssContent;
			this.shadowRoot.appendChild(style);

			logger.debug("成功加载外部CSS到Shadow Root:", cssPath);
		} catch (error) {
			logger.warn("加载外部CSS失败:", error.message);
		}
	}

	/**
	 * 加载外部 CSS 到 document.head (传统模式，非 Shadow DOM)
	 */
	private async loadExternalCSSToHead() {
		try {
			const pluginDir = resolvePluginDir(this.app);
			if (!pluginDir) {
				console.warn("[ZePress] 无法获取插件目录");
				return;
			}

			const adapter = this.app.vault.adapter;
			let cssPath = `${pluginDir}/frontend/style.css`;
			let cssContent = "";
			try {
				cssContent = await adapter.read(cssPath);
			} catch {
				cssPath = `${pluginDir}/styles.css`;
				cssContent = await adapter.read(cssPath);
			}

			// 检查是否已经有这个CSS
			const existingStyle = document.head.querySelector(
				"style[data-zepress-react]",
			);
			if (existingStyle) {
				existingStyle.remove();
			}

			// 创建style标签并插入CSS到document.head
			const style = document.createElement("style");
			style.setAttribute("data-zepress-react", "true");
			style.textContent = cssContent;
			document.head.appendChild(style);

			console.log("[ZePress] 成功加载外部CSS到document.head:", cssPath);
			logger.debug("成功加载外部CSS到document.head:", cssPath);
		} catch (error) {
			console.warn("[ZePress] 加载外部CSS失败:", error);
			logger.warn("加载外部CSS失败:", error);
		}
	}

	private loadFallbackComponent() {
		// 这里可以导入原始的React组件作为备用
		// 暂时不实现，仅记录日志
	}

	/**
	 * Setup HMR listener for hot updates
	 */
	private setupHMRListener() {
		if (!(window as any).__ZEPUBLISH_HMR_MODE__)
			return;

		logger.debug("[HMR] Setting up HMR update listener");

		// Listen for HMR updates
		if ((window as any).import && (window as any).import.meta) {
			// Module updates will be handled by Vite automatically
			logger.debug("[HMR] Vite HMR is active");
		}

		// Listen for manual refresh events
		(window as any).__zepressRefresh = async () => {
			logger.debug("[HMR] Manual refresh triggered");
			if (this.externalReactLib && this.reactContainer) {
				await this.updateExternalReactComponent();
			}
		};
	}

	/**
	 * 将本地图片路径转换为data URL
	 * @param localPath 本地图片路径
	 * @returns data URL或null
	 */
	private async convertLocalImageToDataUrl(
		localPath: string,
	): Promise<string | null> {
		try {
			// 通过Obsidian的资源路径获取文件内容
			const response = await fetch(localPath);
			if (!response.ok) {
				return null;
			}

			const blob = await response.blob();

			// 检查是否是图片
			if (!blob.type.startsWith("image/")) {
				return null;
			}

			// 转换为data URL
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onloadend = () => resolve(reader.result as string);
				reader.onerror = reject;
				reader.readAsDataURL(blob);
			});
		} catch (error) {
			logger.error("转换本地图片为data URL失败:", error);
			return null;
		}
	}

	// 防止无限循环的标志
	private isUpdating: boolean = false;
	private lastUpdateTime: number = 0;
	private readonly MIN_UPDATE_INTERVAL = 100; // 最小更新间隔（毫秒）

	/**
	 * 更新外部React组件
	 */
	private async updateExternalReactComponent(): Promise<void> {
		// 🔒 防止无限循环
		const now = Date.now();
		if (this.isUpdating) {
			console.warn("[ZePress] 跳过更新：正在更新中");
			return;
		}
		if (now - this.lastUpdateTime < this.MIN_UPDATE_INTERVAL) {
			console.warn("[ZePress] 跳过更新：更新过于频繁");
			return;
		}

		this.isUpdating = true;
		this.lastUpdateTime = now;

		try {
			await this._doUpdateExternalReactComponent();
		} finally {
			this.isUpdating = false;
		}
	}

	private async _doUpdateExternalReactComponent(): Promise<void> {
		console.log("[ZePress] updateExternalReactComponent() 开始", {
			hasExternalReactLib: !!this.externalReactLib,
			hasReactContainer: !!this.reactContainer,
			isMounted: this.isMounted,
			useShadowDom: this.USE_SHADOW_DOM,
		});

		if (!this.externalReactLib || !this.reactContainer) {
			console.error("[ZePress] 外部React应用未加载或容器不存在");
			logger.warn("外部React应用未加载或容器不存在", {
				externalReactLib: !!this.externalReactLib,
				reactContainer: !!this.reactContainer,
			});

			// 如果没有外部React应用，显示一个简单的错误消息
			const targetContainer = this.shadowRoot || this.reactContainer;
			if (targetContainer) {
				const errorDiv = document.createElement("div");
				errorDiv.style.cssText =
					"padding: 20px; text-align: center; color: var(--text-muted);";
				errorDiv.innerHTML = `
					<h3>React应用加载失败</h3>
					<p>请检查控制台日志获取更多信息</p>
					<p>插件可能需要重新安装或构建</p>
				`;
				targetContainer.appendChild(errorDiv);
			}
			return;
		}

		try {
			// 检查是否需要重新构建props
			const currentCSS = this.getCSS();
			const needsUpdate =
				!this.cachedProps ||
				this.articleHTML !== this.lastArticleHTML ||
				currentCSS !== this.lastCSSContent;

			if (!needsUpdate && this.isMounted) {
				logger.debug("Props未变化，跳过更新");
				return;
			}

			logger.debug("更新外部React组件", {
				articleHTMLLength: this.articleHTML?.length || 0,
				hasCSS: !!this.getCSS(),
				isMounted: this.isMounted,
				availableMethods: this.externalReactLib
					? Object.keys(this.externalReactLib)
					: [],
				reactContainerInDOM: this.reactContainer
					? document.contains(this.reactContainer)
					: false,
				reactContainerElement: this.reactContainer
					? this.reactContainer.tagName
					: null,
			});

			// 使用新的构建方法获取props
			const props = this.buildReactComponentProps();
			this.cachedProps = props;
			this.lastArticleHTML = this.articleHTML;
			this.lastCSSContent = currentCSS;

			if (!this.isMounted) {
				// 首次挂载
				if (this.USE_SHADOW_DOM && this.shadowRoot) {
					console.log(
						"[ZePress] 首次挂载 React 组件到 Shadow Root",
					);
					logger.info(
						"[Shadow DOM] 首次挂载 React 组件到 Shadow Root",
					);
					this.externalReactLib.mount(this.reactContainer, props, {
						shadowRoot: this.shadowRoot,
					});
				} else {
					console.log("[ZePress] 首次挂载 React 组件 (传统模式)");
					logger.info("[传统模式] 首次挂载 React 组件");
					this.externalReactLib.mount(this.reactContainer, props);
				}
				this.isMounted = true;
				console.log("[ZePress] React 组件挂载完成");
			} else {
				// 后续更新：使用 update 方法
				console.log("[ZePress] 更新 React 组件");
				await this.externalReactLib.update(this.reactContainer, props);
				console.log("[ZePress] React 组件更新完成");
			}

			console.log("[ZePress] updateExternalReactComponent() 完成");
			logger.debug("外部React组件更新成功");
		} catch (error) {
			logger.error("更新外部React组件时出错:", error);
			const targetContainer = this.shadowRoot || this.reactContainer;
			if (targetContainer) {
				const errorDiv = document.createElement("div");
				errorDiv.style.cssText =
					"padding: 20px; text-align: center; color: var(--text-error);";
				errorDiv.innerHTML = `
					<h3>React组件更新失败</h3>
					<p>错误: ${(error as Error).message}</p>
					<p>请检查控制台日志获取详细信息</p>
				`;
				targetContainer.appendChild(errorDiv);
			}
		}
	}

	/**
	 * 上传代码块为图片并替换源Markdown
	 */
	private async uploadCodeBlockAsImage(
		codeContent: string,
		imageDataUrl: string,
	): Promise<{ success: boolean; imageUrl?: string; error?: string }> {
		try {
			const cloudStorage = this.settings.cloudStorage;

			// 检查云存储配置
			if (!cloudStorage?.enabled || cloudStorage.provider !== "qiniu") {
				return { success: false, error: "请先在设置中启用七牛云存储" };
			}

			const { qiniu } = cloudStorage;
			if (
				!qiniu.accessKey ||
				!qiniu.secretKey ||
				!qiniu.bucket ||
				!qiniu.domain
			) {
				return {
					success: false,
					error: "七牛云配置不完整，请检查设置",
				};
			}

			// 将 dataUrl 转换为 Blob
			const response = await fetch(imageDataUrl);
			const blob = await response.blob();

			// 生成唯一文件名
			const timestamp = Date.now();
			const randomStr = Math.random().toString(36).substring(2, 8);
			const fileKey = `zepress/codeblock-${timestamp}-${randomStr}.png`;

			// 生成七牛云上传凭证
			const putPolicy = JSON.stringify({
				scope: `${qiniu.bucket}:${fileKey}`,
				deadline: Math.floor(Date.now() / 1000) + 3600, // 1小时有效
			});
			const encodedPutPolicy = btoa(putPolicy);

			// 使用 Web Crypto API 计算 HMAC-SHA1
			const encoder = new TextEncoder();
			const keyData = encoder.encode(qiniu.secretKey);
			const messageData = encoder.encode(encodedPutPolicy);

			const cryptoKey = await crypto.subtle.importKey(
				"raw",
				keyData,
				{ name: "HMAC", hash: "SHA-1" },
				false,
				["sign"],
			);
			const signature = await crypto.subtle.sign(
				"HMAC",
				cryptoKey,
				messageData,
			);
			const encodedSign = btoa(
				String.fromCharCode(...new Uint8Array(signature)),
			)
				.replace(/\+/g, "-")
				.replace(/\//g, "_");

			const uploadToken = `${qiniu.accessKey}:${encodedSign}:${encodedPutPolicy}`;

			// 上传到七牛云
			const formData = new FormData();
			formData.append("file", blob, fileKey);
			formData.append("token", uploadToken);
			formData.append("key", fileKey);

			// 根据区域选择上传域名
			const uploadHosts: Record<string, string> = {
				z0: "https://up.qiniup.com",
				z1: "https://up-z1.qiniup.com",
				z2: "https://up-z2.qiniup.com",
				na0: "https://up-na0.qiniup.com",
				as0: "https://up-as0.qiniup.com",
			};
			const uploadHost = uploadHosts[qiniu.region] || uploadHosts["z0"];

			const uploadResponse = await fetch(`${uploadHost}`, {
				method: "POST",
				body: formData,
			});

			if (!uploadResponse.ok) {
				const errorText = await uploadResponse.text();
				return { success: false, error: `上传失败: ${errorText}` };
			}

			const uploadResult = await uploadResponse.json();
			const imageUrl = `${qiniu.domain.replace(/\/$/, "")}/${uploadResult.key}`;

			// 保存到云存储列表（localStorage，按 vault 作用域隔离）
			const vaultName =
				this.app.vault.getName?.() || (this.app.vault as any).name || "default-vault";
			const vaultPath =
				(this.app.vault.adapter as any)?.basePath ||
				(this.app.vault.adapter as any)?.path ||
				"";
			const scope = `${vaultName}|${vaultPath}`
				.toLowerCase()
				.replace(/[^a-z0-9|_-]/g, "_");
			const UPLOADED_IMAGES_KEY = `zepress-uploaded-images::${scope}`;
			const existingImages = JSON.parse(
				localStorage.getItem(UPLOADED_IMAGES_KEY) || "[]",
			);
			existingImages.unshift({
				id: `${timestamp}-${randomStr}`,
				name: `codeblock-${timestamp}-${randomStr}.png`,
				url: imageUrl,
				key: fileKey,
				size: blob.size,
				type: "image/png",
				uploadedAt: new Date().toISOString(),
			});
			localStorage.setItem(
				UPLOADED_IMAGES_KEY,
				JSON.stringify(existingImages),
			);
			// 触发自定义事件通知 React 刷新
			window.dispatchEvent(new CustomEvent("zepress-images-updated"));

			// 替换源Markdown中的代码块 - 使用 vault.modify
			const activeFile = this.app.workspace.getActiveFile();
			if (!activeFile) {
				return {
					success: true,
					imageUrl,
					error: "图片已上传，但无法修改源文件（未找到活动文件）",
				};
			}

			const currentContent = await this.app.vault.read(activeFile);

			// 标准化代码内容：去掉行尾空格，统一换行符
			const normalizeCode = (code: string) =>
				code
					.split("\n")
					.map((l) => l.trimEnd())
					.join("\n")
					.trim();
			const normalizedInput = normalizeCode(codeContent);

			// 查找所有代码块并比较内容
			const codeBlockPattern = /```(\w*)\n([\s\S]*?)\n```/g;
			let match;
			let newContent = currentContent;
			let replaced = false;

			while ((match = codeBlockPattern.exec(currentContent)) !== null) {
				const blockContent = normalizeCode(match[2]);
				if (blockContent === normalizedInput) {
					// 找到匹配的代码块，替换它
					newContent =
						currentContent.slice(0, match.index) +
						`![](${imageUrl})` +
						currentContent.slice(match.index + match[0].length);
					replaced = true;
					break;
				}
			}

			if (!replaced) {
				return {
					success: true,
					imageUrl,
					error: "图片已上传，但未找到匹配的代码块进行替换",
				};
			}

			await this.app.vault.modify(activeFile, newContent);
			new Notice("代码块已替换为图片");

			// 触发重新渲染预览
			await this.renderMarkdown();

			return { success: true, imageUrl };
		} catch (error) {
			logger.error("uploadCodeBlockAsImage 失败:", error);
			return { success: false, error: (error as Error).message };
		}
	}

	/**
	 * 上传表格为图片并替换源Markdown
	 */
	private async uploadTableAsImage(
		tableMarkdown: string,
		imageDataUrl: string,
	): Promise<{ success: boolean; imageUrl?: string; error?: string }> {
		try {
			const cloudStorage = this.settings.cloudStorage;

			// 检查云存储配置
			if (!cloudStorage?.enabled || cloudStorage.provider !== "qiniu") {
				return { success: false, error: "请先在设置中启用七牛云存储" };
			}

			const { qiniu } = cloudStorage;
			if (
				!qiniu.accessKey ||
				!qiniu.secretKey ||
				!qiniu.bucket ||
				!qiniu.domain
			) {
				return {
					success: false,
					error: "七牛云配置不完整，请检查设置",
				};
			}

			// 将 dataUrl 转换为 Blob
			const response = await fetch(imageDataUrl);
			const blob = await response.blob();

			// 生成唯一文件名
			const timestamp = Date.now();
			const randomStr = Math.random().toString(36).substring(2, 8);
			const fileKey = `zepress/table-${timestamp}-${randomStr}.png`;

			// 生成七牛云上传凭证
			const putPolicy = JSON.stringify({
				scope: `${qiniu.bucket}:${fileKey}`,
				deadline: Math.floor(Date.now() / 1000) + 3600, // 1小时有效
			});
			const encodedPutPolicy = btoa(putPolicy);

			// 使用 Web Crypto API 计算 HMAC-SHA1
			const encoder = new TextEncoder();
			const keyData = encoder.encode(qiniu.secretKey);
			const messageData = encoder.encode(encodedPutPolicy);

			const cryptoKey = await crypto.subtle.importKey(
				"raw",
				keyData,
				{ name: "HMAC", hash: "SHA-1" },
				false,
				["sign"],
			);
			const signature = await crypto.subtle.sign(
				"HMAC",
				cryptoKey,
				messageData,
			);
			const encodedSign = btoa(
				String.fromCharCode(...new Uint8Array(signature)),
			)
				.replace(/\+/g, "-")
				.replace(/\//g, "_");

			const uploadToken = `${qiniu.accessKey}:${encodedSign}:${encodedPutPolicy}`;

			// 上传到七牛云
			const formData = new FormData();
			formData.append("file", blob, fileKey);
			formData.append("token", uploadToken);
			formData.append("key", fileKey);

			// 根据区域选择上传域名
			const uploadHosts: Record<string, string> = {
				z0: "https://up.qiniup.com",
				z1: "https://up-z1.qiniup.com",
				z2: "https://up-z2.qiniup.com",
				na0: "https://up-na0.qiniup.com",
				as0: "https://up-as0.qiniup.com",
			};
			const uploadHost = uploadHosts[qiniu.region] || uploadHosts["z0"];

			const uploadResponse = await fetch(`${uploadHost}`, {
				method: "POST",
				body: formData,
			});

			if (!uploadResponse.ok) {
				const errorText = await uploadResponse.text();
				return { success: false, error: `上传失败: ${errorText}` };
			}

			const uploadResult = await uploadResponse.json();
			const imageUrl = `${qiniu.domain.replace(/\/$/, "")}/${uploadResult.key}`;

			// 保存到云存储列表（localStorage，按 vault 作用域隔离）
			const vaultName =
				this.app.vault.getName?.() || (this.app.vault as any).name || "default-vault";
			const vaultPath =
				(this.app.vault.adapter as any)?.basePath ||
				(this.app.vault.adapter as any)?.path ||
				"";
			const scope = `${vaultName}|${vaultPath}`
				.toLowerCase()
				.replace(/[^a-z0-9|_-]/g, "_");
			const UPLOADED_IMAGES_KEY = `zepress-uploaded-images::${scope}`;
			const existingImages = JSON.parse(
				localStorage.getItem(UPLOADED_IMAGES_KEY) || "[]",
			);
			existingImages.unshift({
				id: `${timestamp}-${randomStr}`,
				name: `table-${timestamp}-${randomStr}.png`,
				url: imageUrl,
				key: fileKey,
				size: blob.size,
				type: "image/png",
				uploadedAt: new Date().toISOString(),
			});
			localStorage.setItem(
				UPLOADED_IMAGES_KEY,
				JSON.stringify(existingImages),
			);
			// 触发自定义事件通知 React 刷新
			window.dispatchEvent(new CustomEvent("zepress-images-updated"));

			// 替换源Markdown中的表格 - 使用 vault.modify
			const activeFile = this.app.workspace.getActiveFile();
			if (!activeFile) {
				return {
					success: true,
					imageUrl,
					error: "图片已上传，但无法修改源文件（未找到活动文件）",
				};
			}

			const currentContent = await this.app.vault.read(activeFile);

			// 从表格Markdown中提取表头单元格（第一行）用于匹配
			const extractHeaderCells = (tableText: string): string[] => {
				const lines = tableText.split("\n").filter((l) => l.trim());
				if (lines.length === 0) return [];

				// 第一行是表头
				const headerLine = lines[0];
				const cells: string[] = [];
				const cellMatches = headerLine
					.split("|")
					.filter((s) => s.trim());
				for (const cell of cellMatches) {
					const content = cell.trim();
					if (content && !/^[-:]+$/.test(content)) {
						cells.push(content);
					}
				}
				return cells;
			};

			const inputHeaders = extractHeaderCells(tableMarkdown);
			logger.debug("表格匹配 - 输入表头:", inputHeaders);

			if (inputHeaders.length === 0) {
				return {
					success: true,
					imageUrl,
					error: "图片已上传，但无法解析表格表头",
				};
			}

			// 查找所有表格并比较表头
			// Markdown 表格: 以 | 开头的连续行块
			const lines = currentContent.split("\n");
			let tableStart = -1;
			let tableEnd = -1;
			let newContent = currentContent;
			let replaced = false;

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];

				// 检测表格开始（以 | 开头的行）
				if (line.trim().startsWith("|")) {
					if (tableStart === -1) {
						tableStart = i;
					}
					tableEnd = i;
				} else if (tableStart !== -1) {
					// 表格结束，检查是否匹配
					const tableLines = lines.slice(tableStart, tableEnd + 1);
					const tableText = tableLines.join("\n");
					const tableHeaders = extractHeaderCells(tableText);

					logger.debug("表格匹配 - 源文件表头:", tableHeaders);

					// 比较表头是否一致
					if (tableHeaders.length === inputHeaders.length) {
						let allMatch = true;
						for (let j = 0; j < inputHeaders.length; j++) {
							const input = inputHeaders[j]
								.replace(/\s+/g, "")
								.toLowerCase();
							const source = tableHeaders[j]
								.replace(/\s+/g, "")
								.toLowerCase();
							if (input !== source) {
								allMatch = false;
								break;
							}
						}

						if (allMatch) {
							logger.debug("表格匹配成功!");
							// 计算字符位置
							let startCharPos = 0;
							for (let k = 0; k < tableStart; k++) {
								startCharPos += lines[k].length + 1; // +1 for newline
							}
							let endCharPos = startCharPos;
							for (let k = tableStart; k <= tableEnd; k++) {
								endCharPos += lines[k].length + 1;
							}

							newContent =
								currentContent.slice(0, startCharPos) +
								`![](${imageUrl})\n` +
								currentContent.slice(endCharPos);
							replaced = true;
							break;
						}
					}

					// 重置，继续查找下一个表格
					tableStart = -1;
					tableEnd = -1;
				}
			}

			// 检查文件末尾的表格
			if (!replaced && tableStart !== -1) {
				const tableLines = lines.slice(tableStart, tableEnd + 1);
				const tableText = tableLines.join("\n");
				const tableHeaders = extractHeaderCells(tableText);

				if (tableHeaders.length === inputHeaders.length) {
					let allMatch = true;
					for (let j = 0; j < inputHeaders.length; j++) {
						const input = inputHeaders[j]
							.replace(/\s+/g, "")
							.toLowerCase();
						const source = tableHeaders[j]
							.replace(/\s+/g, "")
							.toLowerCase();
						if (input !== source) {
							allMatch = false;
							break;
						}
					}

					if (allMatch) {
						let startCharPos = 0;
						for (let k = 0; k < tableStart; k++) {
							startCharPos += lines[k].length + 1;
						}
						let endCharPos = startCharPos;
						for (let k = tableStart; k <= tableEnd; k++) {
							endCharPos += lines[k].length + 1;
						}

						newContent =
							currentContent.slice(0, startCharPos) +
							`![](${imageUrl})\n` +
							currentContent.slice(endCharPos);
						replaced = true;
					}
				}
			}

			if (!replaced) {
				return {
					success: true,
					imageUrl,
					error: "图片已上传，但未找到匹配的表格进行替换",
				};
			}

			await this.app.vault.modify(activeFile, newContent);
			new Notice("表格已替换为图片");

			// 触发重新渲染预览
			await this.renderMarkdown();

			return { success: true, imageUrl };
		} catch (error) {
			logger.error("uploadTableAsImage 失败:", error);
			return { success: false, error: (error as Error).message };
		}
	}

	/**
	 * 设置全局API，供React组件调用
	 */
	private setupGlobalAPI(): void {
		try {
			// 设置全局API对象
			const globalAPI: GlobalReactAPI = {
				loadTemplateKits: this.reactAPIService.loadTemplateKits.bind(
					this.reactAPIService,
				),
				loadTemplates: this.reactAPIService.loadTemplates.bind(
					this.reactAPIService,
				),
				onKitApply: this.handleKitApply.bind(this),
				onKitCreate: this.handleKitCreate.bind(this),
				onKitDelete: this.handleKitDelete.bind(this),
				onSettingsChange: this.handleSettingsChange.bind(this),
				onPersonalInfoChange: this.handlePersonalInfoChange.bind(this),
				onArticleInfoChange: this.handleArticleInfoChange.bind(this),
				onSaveSettings: this.saveSettingsToPlugin.bind(this),
				persistentStorage: this.buildPersistentStorageAPI(),
				requestUrl: requestUrl,
				uploadCodeBlockAsImage: this.uploadCodeBlockAsImage.bind(this),
				uploadTableAsImage: this.uploadTableAsImage.bind(this),
			};

			(window as any).zepressReactAPI = globalAPI;
			logger.info(
				"[setupGlobalAPI] 全局API已设置完成，包含持久化存储APIs",
			);
		} catch (error) {
			logger.error("[setupGlobalAPI] 设置全局API时出错:", error);
		}
	}

	/**
	 * 获取统一插件数据
	 */
	private getUnifiedPlugins(): PluginData[] {
		try {
			const pluginManager = UnifiedPluginManager.getInstance();
			if (!pluginManager) {
				logger.warn("UnifiedPluginManager 实例为空");
				return [];
			}

			const plugins = pluginManager.getPlugins();
			logger.debug(`获取到 ${plugins.length} 个插件`);
			return plugins.map((plugin: any): PluginData => {
				let description = "";
				if (plugin.getMetadata && plugin.getMetadata().description) {
					description = plugin.getMetadata().description;
				} else if (plugin.getPluginDescription) {
					description = plugin.getPluginDescription();
				}

				// 将新的类型映射回React组件期望的类型（按照标准remark/rehype概念）
				const pluginType = plugin.getType
					? plugin.getType()
					: "unknown";
				const mappedType: "remark" | "rehype" | "unknown" =
					pluginType === "html"
						? "rehype"
						: pluginType === "markdown"
							? "remark"
							: "unknown";

				const pluginData: PluginData = {
					name: plugin.getName ? plugin.getName() : "Unknown Plugin",
					type: mappedType,
					description: description,
					enabled: plugin.isEnabled ? plugin.isEnabled() : true,
					config: plugin.getConfig ? plugin.getConfig() : {},
					metaConfig: plugin.getMetaConfig
						? plugin.getMetaConfig()
						: {},
				};

				logger.debug(
					`插件数据: ${pluginData.name} (${pluginType} -> ${mappedType})`,
				);
				return pluginData;
			});
		} catch (error) {
			logger.warn("无法获取统一插件数据:", error);
			return [];
		}
	}

	private async handleUnifiedPluginToggle(
		pluginName: string,
		enabled: boolean,
	) {
		try {
			const pluginManager = UnifiedPluginManager.getInstance();
			if (pluginManager) {
				const plugin = pluginManager
					.getPlugins()
					.find((p: any) => p.getName && p.getName() === pluginName);
				if (plugin && plugin.setEnabled) {
					plugin.setEnabled(enabled);

					// 清除插件缓存
					this.pluginCache.clear();

					// 清理缓存管理器状态，确保UI正确更新
					LocalImageManager.getInstance().cleanup();
					CardDataManager.getInstance().cleanup();

					this.saveSettingsToPlugin();
					this.renderMarkdown();

					// 强制更新React组件以反映插件状态变化
					this.cachedProps = null; // 清除缓存的props，强制重新构建
					await this.updateExternalReactComponent();

					logger.debug(
						`已${enabled ? "启用" : "禁用"}插件: ${pluginName}`,
					);
				}
			}
		} catch (error) {
			logger.error("切换插件状态失败:", error);
		}
	}

	private async handleUnifiedPluginConfigChange(
		pluginName: string,
		key: string,
		value: string | boolean,
	) {
		try {
			const pluginManager = UnifiedPluginManager.getInstance();
			if (pluginManager) {
				const plugin = pluginManager
					.getPlugins()
					.find((p: any) => p.getName && p.getName() === pluginName);
				if (plugin && plugin.updateConfig) {
					plugin.updateConfig({ [key]: value });

					// 清除插件缓存
					this.pluginCache.clear();

					this.saveSettingsToPlugin();
					this.renderMarkdown();

					// 强制更新React组件以反映配置变化
					this.cachedProps = null; // 清除缓存的props，强制重新构建
					await this.updateExternalReactComponent();

					logger.debug(
						`已更新插件 ${pluginName} 的配置: ${key} = ${value}`,
					);
				}
			}
		} catch (error) {
			logger.error("更新插件配置失败:", error);
		}
	}

	/**
	 * 构建React组件的props
	 */
	private buildReactComponentProps(): ReactComponentPropsWithCallbacks {
		// 转换设置对象以适配外部React应用的接口
		const externalSettings: ReactSettings = {
			defaultStyle: this.settings.defaultStyle,
			defaultHighlight: this.settings.defaultHighlight,
			defaultTemplate: this.settings.defaultTemplate,
			useTemplate: this.settings.useTemplate,
			lastSelectedTemplate: this.settings.lastSelectedTemplate,
			enableThemeColor: this.settings.enableThemeColor,
			themeColor: this.settings.themeColor,
			useCustomCss: this.settings.useCustomCss,
			authKey: this.settings.authKey,
			wxInfo: this.settings.wxInfo,
			expandedAccordionSections:
				this.settings.expandedAccordionSections || [],
			showStyleUI: this.settings.showStyleUI !== false, // 默认显示
			enableDefaultAuthorProfile:
				this.settings.enableDefaultAuthorProfile,
			defaultAuthorName: this.settings.defaultAuthorName,
			defaultAuthorImageData: this.settings.defaultAuthorImageData,
			personalInfo: {
				name: this.settings.personalInfo?.name || "",
				avatar: this.settings.personalInfo?.avatar,
				bio: this.settings.personalInfo?.bio || "",
				email: this.settings.personalInfo?.email || "",
				website: this.settings.personalInfo?.website || "",
				socialLinks: this.settings.personalInfo?.socialLinks,
			},
			aiPromptTemplate: this.settings.aiPromptTemplate || "",
			aiModel: this.settings.aiModel || "claude-3-5-haiku-latest",
			uiThemeMode: this.settings.uiThemeMode,
			imageSaveFolderEnabled: this.settings.imageSaveFolderEnabled,
			imageSaveFolder: this.settings.imageSaveFolder,
			cloudStorage: this.settings.cloudStorage,
			toolbarPosition: this.settings.toolbarPosition,
			scaleCodeBlockInImage: this.settings.scaleCodeBlockInImage,
		};

		// 获取统一插件数据
		const plugins = this.getUnifiedPlugins();

		return {
			settings: externalSettings,
			articleHTML: this.articleHTML || "",
			cssContent: this.getCSS(),
			plugins: plugins,
			onRefresh: async () => {
				await this.renderMarkdown();
				uevent("refresh");
			},
			onCopy: async (mode?: string) => {
				console.log(
					"🎯 [NotePreview] onCopy callback called with mode:",
					mode,
					"type:",
					typeof mode,
				);
				await this.copyArticle(mode);
				uevent("copy");
			},
			onDistribute: async () => {
				this.openDistributionModal();
				uevent("distribute");
			},
			onTemplateChange: this.handleTemplateChange.bind(this),
			onThemeChange: this.handleThemeChange.bind(this),
			onHighlightChange: this.handleHighlightChange.bind(this),
			onThemeColorToggle: this.handleThemeColorToggle.bind(this),
			onThemeColorChange: this.handleThemeColorChange.bind(this),
			onRenderArticle: this.renderArticleOnly.bind(this),
			onSaveSettings: this.saveSettingsToPlugin.bind(this),
			onUpdateCSSVariables: this.updateCSSVariables.bind(this),
			onPluginToggle: this.handleUnifiedPluginToggle.bind(this),
			onPluginConfigChange:
				this.handleUnifiedPluginConfigChange.bind(this),
			onExpandedSectionsChange:
				this.handleExpandedSectionsChange.bind(this),
			onArticleInfoChange: this.handleArticleInfoChange.bind(this),
			onPersonalInfoChange: this.handlePersonalInfoChange.bind(this),
			onSettingsChange: this.handleSettingsChange.bind(this),
			onKitApply: this.handleKitApply.bind(this),
			onKitCreate: this.handleKitCreate.bind(this),
			onKitDelete: this.handleKitDelete.bind(this),
			loadTemplateKits: this.reactAPIService.loadTemplateKits.bind(
				this.reactAPIService,
			),
			loadTemplates: this.reactAPIService.loadTemplates.bind(
				this.reactAPIService,
			),
			persistentStorage: this.buildPersistentStorageAPI(),
			requestUrl: requestUrl,
			onWidthChange: this.handleWidthChange.bind(this),
		};
	}

	/**
	 * 构建持久化存储API
	 */
	private buildPersistentStorageAPI() {
		return {
			// Template Kit Management
			saveTemplateKit: async (kitData: any, customName?: string) => {
				try {
					return await persistentStorageService.saveTemplateKit(
						kitData,
						customName,
					);
				} catch (error) {
					logger.error(
						"[persistentStorage.saveTemplateKit] Error:",
						error,
					);
					throw error;
				}
			},
			getTemplateKits: async () => {
				try {
					return await persistentStorageService.getTemplateKits();
				} catch (error) {
					logger.error(
						"[persistentStorage.getTemplateKits] Error:",
						error,
					);
					throw error;
				}
			},
			deleteTemplateKit: async (id: string) => {
				try {
					return await persistentStorageService.deleteTemplateKit(id);
				} catch (error) {
					logger.error(
						"[persistentStorage.deleteTemplateKit] Error:",
						error,
					);
					throw error;
				}
			},

			// Plugin Configuration Management
			savePluginConfig: async (
				pluginName: string,
				config: any,
				metaConfig: any,
			) => {
				try {
					return await persistentStorageService.savePluginConfig(
						pluginName,
						config,
						metaConfig,
					);
				} catch (error) {
					logger.error(
						"[persistentStorage.savePluginConfig] Error:",
						error,
					);
					throw error;
				}
			},
			getPluginConfigs: async () => {
				try {
					return await persistentStorageService.getPluginConfigs();
				} catch (error) {
					logger.error(
						"[persistentStorage.getPluginConfigs] Error:",
						error,
					);
					throw error;
				}
			},
			getPluginConfig: async (pluginName: string) => {
				try {
					return await persistentStorageService.getPluginConfig(
						pluginName,
					);
				} catch (error) {
					logger.error(
						"[persistentStorage.getPluginConfig] Error:",
						error,
					);
					throw error;
				}
			},

			// Personal Info Management
			savePersonalInfo: async (info: any) => {
				try {
					return await persistentStorageService.savePersonalInfo(
						info,
					);
				} catch (error) {
					logger.error(
						"[persistentStorage.savePersonalInfo] Error:",
						error,
					);
					throw error;
				}
			},
			getPersonalInfo: async () => {
				try {
					return await persistentStorageService.getPersonalInfo();
				} catch (error) {
					logger.error(
						"[persistentStorage.getPersonalInfo] Error:",
						error,
					);
					throw error;
				}
			},

			// Article Info Management
			saveArticleInfo: async (info: any) => {
				try {
					return await persistentStorageService.saveArticleInfo(info);
				} catch (error) {
					logger.error(
						"[persistentStorage.saveArticleInfo] Error:",
						error,
					);
					throw error;
				}
			},
			getArticleInfo: async () => {
				try {
					return await persistentStorageService.getArticleInfo();
				} catch (error) {
					logger.error(
						"[persistentStorage.getArticleInfo] Error:",
						error,
					);
					throw error;
				}
			},

			// Style Settings Management
			saveStyleSettings: async (settings: any) => {
				try {
					return await persistentStorageService.saveStyleSettings(
						settings,
					);
				} catch (error) {
					logger.error(
						"[persistentStorage.saveStyleSettings] Error:",
						error,
					);
					throw error;
				}
			},
			getStyleSettings: async () => {
				try {
					return await persistentStorageService.getStyleSettings();
				} catch (error) {
					logger.error(
						"[persistentStorage.getStyleSettings] Error:",
						error,
					);
					throw error;
				}
			},

			// File and Cover Management
			saveFile: async (file: File, customName?: string) => {
				try {
					return await persistentStorageService.saveFile(
						file,
						customName,
					);
				} catch (error) {
					logger.error("[persistentStorage.saveFile] Error:", error);
					throw error;
				}
			},
			getFiles: async () => {
				try {
					return await persistentStorageService.getFiles();
				} catch (error) {
					logger.error("[persistentStorage.getFiles] Error:", error);
					throw error;
				}
			},
			getFileUrl: async (file: any) => {
				try {
					return await persistentStorageService.getFileUrl(file);
				} catch (error) {
					logger.error(
						"[persistentStorage.getFileUrl] Error:",
						error,
					);
					throw error;
				}
			},
			deleteFile: async (id: string) => {
				try {
					return await persistentStorageService.deleteFile(id);
				} catch (error) {
					logger.error(
						"[persistentStorage.deleteFile] Error:",
						error,
					);
					throw error;
				}
			},
			saveCover: async (coverData: any) => {
				try {
					return await persistentStorageService.saveCover(coverData);
				} catch (error) {
					logger.error("[persistentStorage.saveCover] Error:", error);
					throw error;
				}
			},
			getCovers: async () => {
				try {
					return await persistentStorageService.getCovers();
				} catch (error) {
					logger.error("[persistentStorage.getCovers] Error:", error);
					throw error;
				}
			},
			deleteCover: async (id: string) => {
				try {
					return await persistentStorageService.deleteCover(id);
				} catch (error) {
					logger.error(
						"[persistentStorage.deleteCover] Error:",
						error,
					);
					throw error;
				}
			},

			// Utility functions
			clearAllPersistentData: async () => {
				try {
					return await persistentStorageService.clearAllPersistentData();
				} catch (error) {
					logger.error(
						"[persistentStorage.clearAllPersistentData] Error:",
						error,
					);
					throw error;
				}
			},
			exportAllData: async () => {
				try {
					return await persistentStorageService.exportAllData();
				} catch (error) {
					logger.error(
						"[persistentStorage.exportAllData] Error:",
						error,
					);
					throw error;
				}
			},
		};
	}

	/**
	 * 处理模板变更
	 */
	private async handleTemplateChange(template: string): Promise<void> {
		if (template === "") {
			this.settings.useTemplate = false;
			this.settings.lastSelectedTemplate = "";
		} else {
			this.settings.useTemplate = true;
			this.settings.defaultTemplate = template;
			this.settings.lastSelectedTemplate = template;
		}
		this.saveSettingsToPlugin();
		await this.renderMarkdown();
	}

	/**
	 * 处理主题变更
	 */
	private async handleThemeChange(theme: string): Promise<void> {
		logger.debug(`[handleThemeChange] 切换主题: ${theme}`);
		this.settings.defaultStyle = theme;

		// 清除插件缓存（主题改变可能影响渲染）
		this.pluginCache.clear();

		this.saveSettingsToPlugin();
		logger.debug(`[handleThemeChange] 设置已更新，开始渲染`);
		await this.renderMarkdown();
		logger.debug(`[handleThemeChange] 渲染完成`);

		// 直接异步调用update
		await this.update();
	}

	/**
	 * 处理高亮变更
	 */
	private async handleHighlightChange(highlight: string): Promise<void> {
		this.settings.defaultHighlight = highlight;
		this.saveSettingsToPlugin();
		await this.updateExternalReactComponent();
	}

	/**
	 * 处理主题色开关
	 */
	private async handleThemeColorToggle(enabled: boolean): Promise<void> {
		this.settings.enableThemeColor = enabled;
		this.saveSettingsToPlugin();
		await this.renderMarkdown();
	}

	/**
	 * 处理主题色变更
	 */
	private async handleThemeColorChange(color: string): Promise<void> {
		this.settings.themeColor = color;
		this.saveSettingsToPlugin();
		await this.renderMarkdown();
	}

	/**
	 * 处理展开节控制变更
	 */
	private handleExpandedSectionsChange(sections: string[]): void {
		this.settings.expandedAccordionSections = sections;
		this.saveSettingsToPlugin();
	}

	/**
	 * 处理容器宽度变更
	 */
	private handleWidthChange(width: number): void {
		this.currentWidth = width;
		console.log(
			`[NotePreviewExternal] handleWidthChange called: ${width}px`,
		);
		logger.info(`[NotePreviewExternal] 容器宽度变更: ${width}px`);

		// 通知主插件（如果主插件实现了回调）
		const plugin =
			(this.app as any).plugins.plugins["zepress"] ||
			(this.app as any).plugins.plugins["zepress"];
		if (plugin && typeof plugin.onViewWidthChange === "function") {
			console.log(`[NotePreviewExternal] 调用 plugin.onViewWidthChange`);
			plugin.onViewWidthChange(width);
		} else {
			console.warn(
				`[NotePreviewExternal] plugin.onViewWidthChange not available`,
				{
					hasPlugin: !!plugin,
					type: plugin ? typeof plugin.onViewWidthChange : "N/A",
				},
			);
		}
	}

	/**
	 * 处理文章信息变更
	 */
	private handleArticleInfoChange(info: ArticleInfo): void {
		// 避免无限循环
		if (this.isUpdatingFromToolbar) {
			return;
		}

		// 验证输入
		if (!isValidArticleInfo(info)) {
			logger.warn("[handleArticleInfoChange] 无效的文章信息:", info);
			return;
		}

		// 将文章信息保存到toolbarArticleInfo中，用于渲染时合并
		this.toolbarArticleInfo = info;

		// 设置标志位并异步更新
		this.isUpdatingFromToolbar = true;
		this.updateArticleContentOnly().then(() => {
			this.isUpdatingFromToolbar = false;
		});
	}

	/**
	 * 处理个人信息变更
	 */
	private handlePersonalInfoChange(info: PersonalInfo): void {
		// 验证输入
		if (!isValidPersonalInfo(info)) {
			logger.warn("[handlePersonalInfoChange] 无效的个人信息:", info);
			return;
		}

		logger.debug(
			"[handlePersonalInfoChange] 更新前的设置:",
			this.settings.personalInfo,
		);
		this.settings.personalInfo = info;
		logger.debug(
			"[handlePersonalInfoChange] 更新后的设置:",
			this.settings.personalInfo,
		);
		logger.debug(
			"[handlePersonalInfoChange] 全部设置:",
			this.settings.getAllSettings(),
		);
		this.saveSettingsToPlugin();
	}

	/**
	 * 处理设置变更
	 */
	private handleSettingsChange(settingsUpdate: Partial<ReactSettings>): void {
		logger.debug("[handleSettingsChange] 设置已更新:", settingsUpdate);
		logger.debug(
			"[handleSettingsChange] 更新前的authKey:",
			this.settings.authKey,
		);
		logger.debug(
			"[handleSettingsChange] 更新前的全部设置:",
			this.settings.getAllSettings(),
		);

		// 合并设置更新
		Object.keys(settingsUpdate).forEach((key) => {
			const value = settingsUpdate[key as keyof ReactSettings];
			if (value !== undefined) {
				(this.settings as any)[key] = value;
				logger.debug(`[handleSettingsChange] 已更新 ${key}:`, value);
			}
		});

		logger.debug(
			"[handleSettingsChange] 更新后的authKey:",
			this.settings.authKey,
		);
		logger.debug(
			"[handleSettingsChange] 更新后的全部设置:",
			this.settings.getAllSettings(),
		);
		this.saveSettingsToPlugin();
	}

	/**
	 * 处理套装应用
	 */
	private async handleKitApply(kitId: string): Promise<void> {
		logger.debug(`[handleKitApply] 应用模板套装: ${kitId}`);
		await this.reactAPIService.applyTemplateKit(
			kitId,
			() => this.renderMarkdown(),
			() => this.updateExternalReactComponent(),
		);
	}

	/**
	 * 处理套装创建
	 */
	private async handleKitCreate(
		basicInfo: TemplateKitBasicInfo,
	): Promise<void> {
		logger.debug(`[handleKitCreate] 创建模板套装:`, basicInfo);

		// 验证输入
		if (!isValidTemplateKitBasicInfo(basicInfo)) {
			logger.warn("[handleKitCreate] 无效的套装基本信息:", basicInfo);
			new Notice("无效的套装信息！");
			return;
		}

		await this.reactAPIService.createTemplateKit(basicInfo);
	}

	/**
	 * 处理套装删除
	 */
	private async handleKitDelete(kitId: string): Promise<void> {
		logger.debug(`[handleKitDelete] 删除模板套装: ${kitId}`);
		await this.reactAPIService.deleteTemplateKit(kitId);
	}

	private saveSettingsToPlugin(): void {
		uevent("save-settings");
		const plugin =
			(this.app as any).plugins.plugins["zepress"] ||
			(this.app as any).plugins.plugins["zepress"];
		if (plugin) {
			// 确保主插件使用的是当前的设置实例
			plugin.settings = this.settings;
			logger.debug(
				"正在保存设置到持久化存储",
				this.settings.getAllSettings(),
			);

			// 重要调试：检查设置实例是否正确
			logger.debug("当前设置实例:", this.settings);
			logger.debug("主插件设置实例:", plugin.settings);
			logger.debug(
				"设置实例是否相同:",
				this.settings === plugin.settings,
			);

			// 立即同步调用保存
			plugin.saveSettings();
		} else {
			logger.error("无法找到主插件实例，设置保存失败");
			// 尝试手动保存到本地存储作为备用
			try {
				const settingsData = this.settings.getAllSettings();
				localStorage.setItem(
					"zepress-settings-backup",
					JSON.stringify(settingsData),
				);
				logger.debug("设置已保存到本地存储备份");
			} catch (error) {
				logger.error("本地存储备份失败:", error);
			}
		}
	}
}
