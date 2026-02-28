import { logger } from "../../../shared/src/logger";

export interface ThemeOption {
	name: string;
	className: string;
	desc?: string;
	author?: string;
}

export interface HighlightOption {
	name: string;
	url?: string;
}

export interface TemplateOption {
	name: string;
	filename: string;
}

export interface ResourceLoader {
	loadThemes(): Promise<ThemeOption[]>;

	loadHighlights(): Promise<HighlightOption[]>;

	loadTemplates(): Promise<TemplateOption[]>;
}

class LocalResourceLoader implements ResourceLoader {
	async loadThemes(): Promise<ThemeOption[]> {
		try {
			logger.debug("Loading fallback themes");
			return [
				{ name: "默认主题", className: "default", desc: "Obsidian 默认阅读风格", author: "ZePress" },
				{ name: "微信排版", className: "wechat-classic", desc: "经典微信公众号排版", author: "ZePress" },
				{ name: "大字号", className: "large-text", desc: "适合无障碍阅读的大字版", author: "ZePress" },
			];
		} catch (error) {
			console.error("Failed to load themes:", error);
			return [
				{ name: "默认主题", className: "default" }
			];
		}
	}

	async loadHighlights(): Promise<HighlightOption[]> {
		try {
			logger.debug("Loading fallback highlights");
			return [
				{ name: "github" },
				{ name: "vs2015" },
				{ name: "atom-one-dark" },
				{ name: "atom-one-light" },
			];
		} catch (error) {
			console.error("Failed to load highlights:", error);
			return [
				{ name: "default" },
			];
		}
	}

	async loadTemplates(): Promise<TemplateOption[]> {
		try {
			logger.debug("Loading templates dynamically from backend API");

			// 尝试从后端API加载模板
			if (
				window.zepressReactAPI &&
				window.zepressReactAPI.loadTemplates
			) {
				try {
					const templateNames =
						await window.zepressReactAPI.loadTemplates();
					logger.info(
						"Loaded templates from backend:",
						templateNames,
					);

					// 转换为前端需要的格式，添加"不使用模板"选项
					const templates: TemplateOption[] = [
						{ name: "不使用模板", filename: "none" },
					];

					// 添加从后端获取的模板
					templateNames.forEach((templateName: string) => {
						templates.push({
							name: templateName,
							filename: templateName,
						});
					});

					return templates;
				} catch (apiError) {
					logger.error(
						"Failed to load templates from backend API:",
						apiError,
					);
					// 继续使用静态列表作为后备
				}
			}

			// 后备：使用静态列表
			logger.debug("Using static template list as fallback");
			return [{ name: "不使用模板", filename: "none" }];
		} catch (error) {
			console.error("Failed to load templates:", error);
			console.error("Using minimal fallback templates");
			return [{ name: "不使用模板", filename: "none" }];
		}
	}
}

export const resourceLoader = new LocalResourceLoader();
