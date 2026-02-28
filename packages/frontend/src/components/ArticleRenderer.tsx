import React, { useRef, useEffect, memo, useMemo } from "react";
import { domToPng } from "modern-screenshot";
import { domUpdater } from "../utils/domUpdater";
import { useAtomValue } from "jotai";
import { settingsAtom } from "../store/atoms";

interface ArticleRendererProps {
	html: string;
}

/**
 * 创建复制按钮（原生 DOM）
 */
function createCopyButton(codeElement: HTMLElement): HTMLButtonElement {
	const btn = document.createElement("button");
	btn.className = "zepress-code-copy-btn";
	btn.title = "复制代码";
	btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

	Object.assign(btn.style, {
		position: "absolute",
		top: "8px",
		right: "8px",
		padding: "6px",
		borderRadius: "4px",
		border: "none",
		cursor: "pointer",
		backgroundColor: "rgba(0,0,0,0.3)",
		color: "rgba(255,255,255,0.8)",
		transition: "all 0.2s",
		zIndex: "20",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
	});

	btn.addEventListener("mouseenter", () => {
		btn.style.backgroundColor = "rgba(0,0,0,0.5)";
		btn.style.color = "#fff";
	});

	btn.addEventListener("mouseleave", () => {
		btn.style.backgroundColor = "rgba(0,0,0,0.3)";
		btn.style.color = "rgba(255,255,255,0.8)";
	});

	btn.addEventListener("click", async () => {
		const text = codeElement.textContent || "";
		try {
			await navigator.clipboard.writeText(text);
			btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
			btn.title = "已复制";
			setTimeout(() => {
				btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
				btn.title = "复制代码";
			}, 2000);
		} catch (err) {
			console.error("Failed to copy:", err);
		}
	});

	return btn;
}

/**
 * 创建复制为图片按钮（原生 DOM）
 */
function createCopyAsImageButton(preElement: HTMLElement): HTMLButtonElement {
	const btn = document.createElement("button");
	btn.className = "zepress-code-copy-img-btn";
	btn.title = "复制为图片";
	// 图片图标
	btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;

	Object.assign(btn.style, {
		position: "absolute",
		top: "8px",
		right: "40px", // 在复制按钮左边
		padding: "6px",
		borderRadius: "4px",
		border: "none",
		cursor: "pointer",
		backgroundColor: "rgba(0,0,0,0.3)",
		color: "rgba(255,255,255,0.8)",
		transition: "all 0.2s",
		zIndex: "20",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
	});

	btn.addEventListener("mouseenter", () => {
		btn.style.backgroundColor = "rgba(0,0,0,0.5)";
		btn.style.color = "#fff";
	});

	btn.addEventListener("mouseleave", () => {
		btn.style.backgroundColor = "rgba(0,0,0,0.3)";
		btn.style.color = "rgba(255,255,255,0.8)";
	});

	btn.addEventListener("click", async () => {
		try {
			// 检查是否有 zoom 缩放
			const zoomValue = preElement.style.getPropertyValue("zoom");
			const zoomRatio = zoomValue ? parseFloat(zoomValue) : 1;
			const hasZoom = zoomValue && zoomRatio < 1;

			// 克隆元素到隐藏容器进行截图，避免抖动
			const clone = preElement.cloneNode(true) as HTMLElement;

			// 移除克隆元素中的按钮
			clone
				.querySelectorAll(
					".zepress-code-copy-btn, .zepress-code-copy-img-btn",
				)
				.forEach((el) => el.remove());

			// 如果有 zoom，在克隆元素上移除并展开
			if (hasZoom) {
				clone.style.removeProperty("zoom");
				clone.style.overflow = "visible";
				clone.style.width = "fit-content";
				clone.style.maxWidth = "none";
			}

			// 创建不可见容器（opacity: 0 保证可渲染但不可见）
			const container = document.createElement("div");
			Object.assign(container.style, {
				position: "fixed",
				left: "0",
				top: "0",
				opacity: "0",
				pointerEvents: "none",
				zIndex: "-1",
			});
			container.appendChild(clone);
			document.body.appendChild(container);

			// 截图克隆元素
			const dataUrl = await domToPng(clone, {
				scale: 2,
				backgroundColor: null,
			});

			// 清理
			document.body.removeChild(container);

			let finalBlob: Blob;

			if (hasZoom) {
				// 用 Canvas 缩放图片以模拟 zoom 效果
				const img = new Image();
				await new Promise<void>((resolve, reject) => {
					img.onload = () => resolve();
					img.onerror = reject;
					img.src = dataUrl;
				});

				const canvas = document.createElement("canvas");
				const targetWidth = Math.round(img.width * zoomRatio);
				const targetHeight = Math.round(img.height * zoomRatio);
				canvas.width = targetWidth;
				canvas.height = targetHeight;

				const ctx = canvas.getContext("2d")!;
				ctx.imageSmoothingEnabled = true;
				ctx.imageSmoothingQuality = "high";
				ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

				finalBlob = await new Promise<Blob>((resolve, reject) => {
					canvas.toBlob((blob) => {
						if (blob) resolve(blob);
						else reject(new Error("Canvas toBlob failed"));
					}, "image/png");
				});
			} else {
				// 无缩放，直接使用原图
				const res = await fetch(dataUrl);
				finalBlob = await res.blob();
			}

			// 复制到剪贴板
			await navigator.clipboard.write([
				new ClipboardItem({ "image/png": finalBlob }),
			]);

			// 成功反馈
			btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
			btn.title = "已复制";
			setTimeout(() => {
				btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
				btn.title = "复制为图片";
			}, 2000);
		} catch (err) {
			console.error("Failed to copy as image:", err);
		}
	});

	return btn;
}

/**
 * 从 HTML 表格元素提取 Markdown 格式的表格内容
 */
function extractTableMarkdown(tableElement: HTMLElement): string {
	const rows: string[] = [];
	const tableRows = tableElement.querySelectorAll("tr");

	tableRows.forEach((tr, rowIndex) => {
		const cells = tr.querySelectorAll("th, td");
		const cellContents: string[] = [];

		cells.forEach((cell) => {
			// 获取单元格文本内容，处理内部的格式
			let text = cell.textContent?.trim() || "";
			// 转义 | 字符
			text = text.replace(/\|/g, "\\|");
			cellContents.push(text);
		});

		rows.push(`| ${cellContents.join(" | ")} |`);

		// 在表头行后添加分隔行
		if (rowIndex === 0 && tr.querySelector("th")) {
			const separators = Array(cells.length).fill("---");
			rows.push(`| ${separators.join(" | ")} |`);
		}
	});

	return rows.join("\n");
}

/**
 * 创建表格上传为图片按钮（原生 DOM）
 * 截图表格并上传到云存储，替换源Markdown
 */
function createTableUploadAsImageButton(
	tableElement: HTMLElement,
): HTMLButtonElement {
	const btn = document.createElement("button");
	btn.className = "zepress-table-upload-btn";
	btn.title = "上传为图片";
	// 上传图标
	btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;

	Object.assign(btn.style, {
		position: "absolute",
		top: "8px",
		right: "40px", // 在复制为图片按钮左边
		padding: "6px",
		borderRadius: "4px",
		border: "none",
		cursor: "pointer",
		backgroundColor: "rgba(0,0,0,0.3)",
		color: "rgba(255,255,255,0.8)",
		transition: "all 0.2s",
		zIndex: "20",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
	});

	btn.addEventListener("mouseenter", () => {
		btn.style.backgroundColor = "rgba(0,0,0,0.5)";
		btn.style.color = "#fff";
	});

	btn.addEventListener("mouseleave", () => {
		btn.style.backgroundColor = "rgba(0,0,0,0.3)";
		btn.style.color = "rgba(255,255,255,0.8)";
	});

	btn.addEventListener("click", async () => {
		try {
			// 检查API是否可用
			const api = (window as any).zepressReactAPI;
			if (!api?.uploadTableAsImage) {
				console.error("uploadTableAsImage API not available");
				return;
			}

			// 显示加载状态
			btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>`;
			btn.title = "上传中...";

			// 临时隐藏按钮
			const btns = tableElement.parentElement?.querySelectorAll(
				".zepress-table-copy-img-btn, .zepress-table-upload-btn",
			);
			btns?.forEach((b) => ((b as HTMLElement).style.display = "none"));

			// 直接截图原始表格（避免克隆导致的样式丢失问题）
			const dataUrl = await domToPng(tableElement, {
				scale: 2,
				backgroundColor: "#ffffff",
			});

			// 恢复按钮显示
			btns?.forEach((b) => ((b as HTMLElement).style.display = "flex"));

			// 提取表格的Markdown内容用于匹配
			const tableMarkdown = extractTableMarkdown(tableElement);

			// 调用API上传并替换
			const result = await api.uploadTableAsImage(tableMarkdown, dataUrl);

			if (result.success) {
				btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
				btn.title = result.error || "已上传";
			} else {
				btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
				btn.title = result.error || "上传失败";
			}

			setTimeout(() => {
				btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
				btn.title = "上传为图片";
			}, 3000);
		} catch (err) {
			console.error("Failed to upload table as image:", err);
			btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
			btn.title = "上传失败";
		}
	});

	return btn;
}

/**
 * 创建表格复制为图片按钮（原生 DOM）
 */
function createTableCopyAsImageButton(
	tableElement: HTMLElement,
): HTMLButtonElement {
	const btn = document.createElement("button");
	btn.className = "zepress-table-copy-img-btn";
	btn.title = "复制为图片";
	// 图片图标
	btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;

	Object.assign(btn.style, {
		position: "absolute",
		top: "8px",
		right: "8px",
		padding: "6px",
		borderRadius: "4px",
		border: "none",
		cursor: "pointer",
		backgroundColor: "rgba(0,0,0,0.3)",
		color: "rgba(255,255,255,0.8)",
		transition: "all 0.2s",
		zIndex: "20",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
	});

	btn.addEventListener("mouseenter", () => {
		btn.style.backgroundColor = "rgba(0,0,0,0.5)";
		btn.style.color = "#fff";
	});

	btn.addEventListener("mouseleave", () => {
		btn.style.backgroundColor = "rgba(0,0,0,0.3)";
		btn.style.color = "rgba(255,255,255,0.8)";
	});

	btn.addEventListener("click", async () => {
		try {
			// 临时隐藏按钮
			const btns = tableElement.parentElement?.querySelectorAll(
				".zepress-table-copy-img-btn, .zepress-table-upload-btn",
			);
			btns?.forEach((b) => ((b as HTMLElement).style.display = "none"));

			// 直接截图原始表格（避免克隆导致的样式丢失问题）
			const dataUrl = await domToPng(tableElement, {
				scale: 2,
				backgroundColor: "#ffffff",
			});

			// 恢复按钮显示
			btns?.forEach((b) => ((b as HTMLElement).style.display = "flex"));

			// 转换为 Blob 并复制到剪贴板
			const res = await fetch(dataUrl);
			const blob = await res.blob();

			await navigator.clipboard.write([
				new ClipboardItem({ "image/png": blob }),
			]);

			// 成功反馈
			btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
			btn.title = "已复制";
			setTimeout(() => {
				btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
				btn.title = "复制为图片";
			}, 2000);
		} catch (err) {
			console.error("Failed to copy table as image:", err);
		}
	});

	return btn;
}

/**
 * 创建信息查看按钮（原生 DOM）
 * 显示代码块的语言、行数、字符数等信息
 */
function createInfoButton(codeElement: HTMLElement): HTMLButtonElement {
	const btn = document.createElement("button");
	btn.className = "zepress-code-info-btn";
	btn.title = "查看信息";
	// info 图标
	btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;

	Object.assign(btn.style, {
		position: "absolute",
		top: "8px",
		right: "104px", // 在上传按钮左边
		padding: "6px",
		borderRadius: "4px",
		border: "none",
		cursor: "pointer",
		backgroundColor: "rgba(0,0,0,0.3)",
		color: "rgba(255,255,255,0.8)",
		transition: "all 0.2s",
		zIndex: "20",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
	});

	btn.addEventListener("mouseenter", () => {
		btn.style.backgroundColor = "rgba(0,0,0,0.5)";
		btn.style.color = "#fff";
	});

	btn.addEventListener("mouseleave", () => {
		btn.style.backgroundColor = "rgba(0,0,0,0.3)";
		btn.style.color = "rgba(255,255,255,0.8)";
	});

	// 创建 tooltip 弹窗
	let tooltip: HTMLDivElement | null = null;

	const showTooltip = () => {
		if (tooltip) return;

		// 获取代码信息
		const text = codeElement.textContent || "";
		const lines = text.split("\n");
		const lineCount = lines.length;
		const charCount = text.length;
		const wordCount = text.trim().split(/\s+/).filter(Boolean).length;

		// 从 class 获取语言（如 language-javascript）
		const langClass = Array.from(codeElement.classList).find((c) =>
			c.startsWith("language-"),
		);
		const language = langClass
			? langClass.replace("language-", "")
			: "plain text";

		tooltip = document.createElement("div");
		tooltip.className = "zepress-code-info-tooltip";
		tooltip.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.2);padding-bottom:4px;">代码信息</div>
      <div style="display:flex;justify-content:space-between;gap:16px;"><span>语言</span><span>${language}</span></div>
      <div style="display:flex;justify-content:space-between;gap:16px;"><span>行数</span><span>${lineCount}</span></div>
      <div style="display:flex;justify-content:space-between;gap:16px;"><span>字符</span><span>${charCount}</span></div>
      <div style="display:flex;justify-content:space-between;gap:16px;"><span>单词</span><span>${wordCount}</span></div>
    `;

		Object.assign(tooltip.style, {
			position: "absolute",
			top: "36px",
			right: "104px",
			padding: "8px 12px",
			borderRadius: "6px",
			backgroundColor: "rgba(0,0,0,0.85)",
			color: "#fff",
			fontSize: "12px",
			lineHeight: "1.6",
			zIndex: "30",
			minWidth: "120px",
			boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
		});

		btn.parentElement?.appendChild(tooltip);
	};

	const hideTooltip = () => {
		if (tooltip) {
			tooltip.remove();
			tooltip = null;
		}
	};

	btn.addEventListener("mouseenter", showTooltip);
	btn.addEventListener("mouseleave", hideTooltip);

	return btn;
}

/**
 * 创建上传为图片按钮（原生 DOM）
 * 截图代码块并上传到云存储，替换源Markdown
 */
function createUploadAsImageButton(
	preElement: HTMLElement,
	codeElement: HTMLElement,
): HTMLButtonElement {
	const btn = document.createElement("button");
	btn.className = "zepress-code-upload-btn";
	btn.title = "上传为图片";
	// 上传图标
	btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;

	Object.assign(btn.style, {
		position: "absolute",
		top: "8px",
		right: "72px", // 在复制为图片按钮左边
		padding: "6px",
		borderRadius: "4px",
		border: "none",
		cursor: "pointer",
		backgroundColor: "rgba(0,0,0,0.3)",
		color: "rgba(255,255,255,0.8)",
		transition: "all 0.2s",
		zIndex: "20",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
	});

	btn.addEventListener("mouseenter", () => {
		btn.style.backgroundColor = "rgba(0,0,0,0.5)";
		btn.style.color = "#fff";
	});

	btn.addEventListener("mouseleave", () => {
		btn.style.backgroundColor = "rgba(0,0,0,0.3)";
		btn.style.color = "rgba(255,255,255,0.8)";
	});

	btn.addEventListener("click", async () => {
		try {
			// 检查API是否可用
			const api = (window as any).zepressReactAPI;
			if (!api?.uploadCodeBlockAsImage) {
				console.error("uploadCodeBlockAsImage API not available");
				return;
			}

			// 显示加载状态
			btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>`;
			btn.title = "上传中...";

			// 克隆元素截图
			const clone = preElement.cloneNode(true) as HTMLElement;
			clone
				.querySelectorAll(
					".zepress-code-copy-btn, .zepress-code-copy-img-btn, .zepress-code-upload-btn, .zepress-code-info-btn, .zepress-code-info-tooltip",
				)
				.forEach((el) => el.remove());

			// 处理 zoom
			const zoomValue = preElement.style.getPropertyValue("zoom");
			const zoomRatio = zoomValue ? parseFloat(zoomValue) : 1;
			const hasZoom = zoomValue && zoomRatio < 1;

			if (hasZoom) {
				clone.style.removeProperty("zoom");
				clone.style.overflow = "visible";
				clone.style.width = "fit-content";
				clone.style.maxWidth = "none";
			}

			const container = document.createElement("div");
			Object.assign(container.style, {
				position: "fixed",
				left: "0",
				top: "0",
				opacity: "0",
				pointerEvents: "none",
				zIndex: "-1",
			});
			container.appendChild(clone);
			document.body.appendChild(container);

			let dataUrl = await domToPng(clone, {
				scale: 2,
				backgroundColor: null,
			});
			document.body.removeChild(container);

			// 如果有 zoom，缩放图片
			if (hasZoom) {
				const img = new Image();
				await new Promise<void>((resolve, reject) => {
					img.onload = () => resolve();
					img.onerror = reject;
					img.src = dataUrl;
				});

				const canvas = document.createElement("canvas");
				canvas.width = Math.round(img.width * zoomRatio);
				canvas.height = Math.round(img.height * zoomRatio);
				const ctx = canvas.getContext("2d")!;
				ctx.imageSmoothingEnabled = true;
				ctx.imageSmoothingQuality = "high";
				ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
				dataUrl = canvas.toDataURL("image/png");
			}

			// 获取代码内容用于匹配
			const codeContent = codeElement.textContent || "";

			// 调用API上传并替换
			const result = await api.uploadCodeBlockAsImage(
				codeContent,
				dataUrl,
			);

			if (result.success) {
				btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
				btn.title = result.error || "已上传";
			} else {
				btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
				btn.title = result.error || "上传失败";
			}

			setTimeout(() => {
				btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
				btn.title = "上传为图片";
			}, 3000);
		} catch (err) {
			console.error("Failed to upload as image:", err);
			btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
			btn.title = "上传失败";
		}
	});

	return btn;
}

/**
 * 文章渲染组件
 * 初始渲染后，通过domUpdater直接更新DOM
 * 使用 memo 避免父组件状态变化导致不必要的重渲染（会清除注入的按钮）
 */
export const ArticleRenderer: React.FC<ArticleRendererProps> = memo(
	({ html }) => {
		const containerRef = useRef<HTMLDivElement>(null);
		const isInitialized = useRef(false);
		const mermaidRef = useRef<any>(null);
		const mermaidInitPromiseRef = useRef<Promise<any> | null>(null);
		const mermaidRenderQueueRef = useRef<Promise<void>>(Promise.resolve());
		const mermaidRenderSeqRef = useRef(0);
		const settings = useAtomValue(settingsAtom);

		const escapeHtml = (input: string) =>
			input
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;");

		// 根据设置决定是否隐藏首个 H1、是否在文章开头显示封面
		const finalHtml = useMemo(() => {
			let processedHtml = html;

			// 与“显示封面”一致，走前端实时渲染路径
			if (settings.hideFirstHeading === true) {
				processedHtml = processedHtml.replace(
					/<h1[^>]*>[\s\S]*?<\/h1>/,
					"",
				);
			}

			if (settings.showCoverInArticle !== false) {
				try {
					const coverData = localStorage.getItem(
						"cover-designer-preview-1",
					);
					if (coverData) {
						const parsed = JSON.parse(coverData);
						const cover = parsed?.covers?.[0];
						if (cover?.imageUrl) {
							// 使用 p>img 结构，与 markdown 渲染的图片一致
							const coverHtml = `<p><img src="${cover.imageUrl}" alt="封面" /></p>`;
							processedHtml = coverHtml + processedHtml;
						}
					}
				} catch {
					// 忽略解析错误
				}
			}
			if (
				settings.enableDefaultAuthorProfile &&
				settings.defaultAuthorImageData
			) {
				const authorTail =
					`<p class="zepress-author-tail"><img src="${settings.defaultAuthorImageData}" alt="作者信息" /></p>`;
				processedHtml += authorTail;
			}
			return processedHtml;
		}, [
			html,
			settings.hideFirstHeading,
			settings.showCoverInArticle,
			settings.enableDefaultAuthorProfile,
			settings.defaultAuthorImageData,
		]);

		useEffect(() => {
			if (containerRef.current) {
				// 注册容器到domUpdater
				domUpdater.setArticleContainer(containerRef.current);

				// 如果不是首次渲染，不更新（让domUpdater处理）
				if (isInitialized.current) {
					return;
				}

				// 标记为已初始化
				isInitialized.current = true;
			}

			// 清理函数
			return () => {
				domUpdater.setArticleContainer(null);
			};
		}, []);

		// 注入复制按钮到代码块（使用原生 DOM，避免 React 重渲染清除按钮）
		useEffect(() => {
			if (!containerRef.current) return;

			const getMermaidApi = async () => {
				if (mermaidRef.current) return mermaidRef.current;
				if (!mermaidInitPromiseRef.current) {
					mermaidInitPromiseRef.current = (async () => {
						const mermaidModule = await import("mermaid");
						const api = mermaidModule.default;
						// Mermaid 初始化只执行一次，避免重复初始化导致状态不稳定
						api.initialize({
							startOnLoad: false,
							securityLevel: "loose",
							theme: "neutral",
							fontFamily:
								'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
						});
						mermaidRef.current = api;
						return api;
					})();
				}
				return mermaidInitPromiseRef.current;
			};

			const buildMermaidSourceCandidates = (rawSource: string): string[] => {
				const stripLineNumberPrefix = (input: string) => {
					const lines = input.split(/\r?\n/);
					return lines
						.map((line, index) => {
							const trimmed = line.trim();
							// 场景1: "12    A --> B" 这类复制时带行号
							let normalized = line.replace(/^\s*\d+\s+/, "");
							// 场景2: 首行 "1flowchart TD" / "1graph TD"（行号紧贴语法）
							if (index === 0) {
								normalized = normalized.replace(
									/^\s*\d+(flowchart|graph)\b/i,
									"$1",
								);
							}
							// 兜底：如果行内容只剩编号，不影响结果
							if (/^\d+$/.test(trimmed)) {
								return "";
							}
							return normalized;
						})
						.join("\n")
						.trim();
				};

				const source = stripLineNumberPrefix(rawSource.trim());
				const candidates: string[] = [];
				const pushUnique = (value: string) => {
					const normalized = value.trim();
					if (!normalized) return;
					if (!candidates.includes(normalized)) {
						candidates.push(normalized);
					}
				};

				// 原始内容
				pushUnique(source);
				// Mermaid 在部分版本/语法中对 \n 兼容不稳定，做兜底归一化
				pushUnique(source.replace(/\\n/g, "<br/>"));
				pushUnique(source.replace(/\\n/g, "\n"));
				// 进一步兜底：同时处理换行和箭头前后空格
				pushUnique(
					source
						.replace(/\\n/g, "<br/>")
						.replace(/\s*-->\s*/g, " --> "),
				);

				return candidates;
			};

			const injectCopyButtons = async () => {
				const container = containerRef.current;
				if (!container) return;

				// 排队串行执行，避免并发调用导致 Mermaid 状态错乱和节点竞争替换
				mermaidRenderQueueRef.current = mermaidRenderQueueRef.current
					.then(async () => {
						const latestContainer = containerRef.current;
						if (!latestContainer || !latestContainer.isConnected) return;

						// 等待一帧，确保 domUpdater 更新后的 DOM 结构稳定
						await new Promise<void>((resolve) =>
							requestAnimationFrame(() => resolve()),
						);

						const mermaidBlocks = Array.from(
							latestContainer.querySelectorAll<HTMLElement>(
								"pre > code",
							),
						).filter((block) => {
							const status = block.dataset.zepressMermaidStatus;
							if (status === "rendering" || status === "done") {
								return false;
							}
							const classes = Array.from(block.classList).map((c) =>
								c.toLowerCase(),
							);
							return classes.some(
								(c) => c === "language-mermaid" || c === "mermaid",
							);
						});

						if (mermaidBlocks.length > 0) {
							try {
								const mermaid = await getMermaidApi();
								for (
									let index = 0;
									index < mermaidBlocks.length;
									index++
								) {
									const code = mermaidBlocks[index];
									const source = code.textContent?.trim() ?? "";
									const pre = code.closest("pre");
									if (
										!source ||
										!pre ||
										!pre.parentElement ||
										!code.isConnected ||
										!pre.isConnected
									) {
										continue;
									}
									code.dataset.zepressMermaidStatus = "rendering";
									const renderId = `zepress-mermaid-${Date.now()}-${index}-${mermaidRenderSeqRef.current++}`;
									const wrapper = document.createElement("div");
									wrapper.className = "zepress-mermaid-wrapper";
									wrapper.style.background = "transparent";
									wrapper.style.overflowX = "auto";
									try {
										const candidates =
											buildMermaidSourceCandidates(source);
										let rendered = false;
										let lastError: unknown = null;
										for (let i = 0; i < candidates.length; i++) {
											try {
												const { svg } = await mermaid.render(
													`${renderId}-${i}`,
													candidates[i],
												);
												wrapper.innerHTML = svg;
												rendered = true;
												break;
											} catch (err) {
												lastError = err;
											}
										}
										if (!rendered) {
											throw lastError ?? new Error("Mermaid render failed");
										}
										const svgEl = wrapper.querySelector("svg");
										if (svgEl) {
											svgEl.style.maxWidth = "100%";
											svgEl.style.width = "auto";
											svgEl.style.height = "auto";
											svgEl.style.display = "block";
											svgEl.style.margin = "0 auto";
										}
									} catch (error) {
										wrapper.innerHTML = `<pre><code>${escapeHtml(source)}</code></pre>`;
										console.error(
											"Failed to render mermaid:",
											error,
										);
									}
									code.dataset.zepressMermaidStatus = "done";
									if (pre.isConnected) {
										pre.replaceWith(wrapper);
									}
								}
							} catch (error) {
								console.error("Failed to load mermaid:", error);
							}
						}

						// 清理旧按钮和 tooltip
						latestContainer
							.querySelectorAll(
								".zepress-code-copy-btn, .zepress-code-copy-img-btn, .zepress-code-upload-btn, .zepress-code-info-btn, .zepress-code-info-tooltip, .zepress-table-copy-img-btn, .zepress-table-upload-btn",
							)
							.forEach((el) => el.remove());

						// 处理代码块
						const preElements = latestContainer.querySelectorAll("pre");

						preElements.forEach((pre) => {
							const code = pre.querySelector("code");
							if (!code) return;
							const codeClasses = Array.from(code.classList).map((c) =>
								c.toLowerCase(),
							);
							if (
								codeClasses.includes("language-mermaid") ||
								codeClasses.includes("mermaid")
							) {
								return;
							}

							// 设置 pre 为 relative 定位
							(pre as HTMLElement).style.position = "relative";

							// 创建并添加按钮（从右到左：复制代码、复制为图片、上传为图片、查看信息）
							const copyBtn = createCopyButton(code as HTMLElement);
							const imgBtn = createCopyAsImageButton(pre as HTMLElement);
							const uploadBtn = createUploadAsImageButton(
								pre as HTMLElement,
								code as HTMLElement,
							);
							const infoBtn = createInfoButton(code as HTMLElement);
							pre.appendChild(infoBtn);
							pre.appendChild(uploadBtn);
							pre.appendChild(imgBtn);
							pre.appendChild(copyBtn);
						});

						// 处理表格 - 添加复制为图片按钮
						const tableElements = latestContainer.querySelectorAll("table");

						tableElements.forEach((table) => {
							// 表格需要包裹在一个 relative 容器中，以便定位按钮
							let wrapper = table.parentElement;

							// 检查是否已经有包裹容器
							if (
								!wrapper ||
								!wrapper.classList.contains("zepress-table-wrapper")
							) {
								wrapper = document.createElement("div");
								wrapper.className = "zepress-table-wrapper";
								Object.assign(wrapper.style, {
									position: "relative",
									display: "inline-block",
									width: "100%",
								});
								table.parentNode?.insertBefore(wrapper, table);
								wrapper.appendChild(table);
							}

							// 创建并添加按钮（从右到左：复制为图片、上传为图片）
							const imgBtn = createTableCopyAsImageButton(
								table as HTMLElement,
							);
							const uploadBtn = createTableUploadAsImageButton(
								table as HTMLElement,
							);
							wrapper.appendChild(uploadBtn);
							wrapper.appendChild(imgBtn);
						});
					})
					.catch((error) => {
						console.error(
							"Failed to process code block enhancement queue:",
							error,
						);
					});
			};

			// 初始注入（使用 rAF 确保 DOM 已渲染）
			const rafId = requestAnimationFrame(injectCopyButtons);

			// 订阅 domUpdater 更新事件
			const unsubscribe = domUpdater.onUpdate(injectCopyButtons);

			return () => {
				cancelAnimationFrame(rafId);
				unsubscribe();
			};
		}, [finalHtml, settings.uiThemeMode]);

		return (
			<div
				ref={containerRef}
				dangerouslySetInnerHTML={{ __html: finalHtml }}
			/>
		);
	},
);

ArticleRenderer.displayName = "ArticleRenderer";
