import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Palette } from "lucide-react";
import { TemplateKit, ViteReactSettings } from "../../types";
import { Button } from "../ui/button";
import { logger } from "../../../../shared/src/logger";

interface TemplateKitSelectorProps {
	settings: ViteReactSettings;
	onKitApply?: (kitId: string) => void | Promise<void>;
	onKitCreate?: (basicInfo: any) => void;
	onKitDelete?: (kitId: string) => void;
	onSettingsChange?: (settings: Partial<ViteReactSettings>) => void;
	onTemplateChange?: (template: string) => void;
	onThemeChange?: (theme: string) => void;
	onHighlightChange?: (highlight: string) => void;
	onThemeColorToggle?: (enabled: boolean) => void;
	onThemeColorChange?: (color: string) => void;
	onRenderArticle?: () => void | Promise<void>;
}

export const TemplateKitSelector: React.FC<TemplateKitSelectorProps> = ({
	settings,
	onKitApply,
}) => {
	const [kits, setKits] = useState<TemplateKit[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [applyingKitId, setApplyingKitId] = useState<string>("");
	const [isHostDarkMode, setIsHostDarkMode] = useState(false);

	const detectHostDarkMode = useCallback(() => {
		try {
			return (
				document.body.classList.contains("theme-dark") ||
				document.documentElement.classList.contains("theme-dark")
			);
		} catch {
			return false;
		}
	}, []);

	const loadKits = async () => {
		try {
			setLoading(true);
			setError("");
			if (!window.zepressReactAPI?.loadTemplateKits) {
				throw new Error("Template kit API not available");
			}
			const loaded = await window.zepressReactAPI.loadTemplateKits();
			setKits(loaded as TemplateKit[]);
		} catch (e) {
			const msg = (e as Error).message || "加载套装失败";
			setError(msg);
			logger.error("[TemplateKitSelector] load kits failed:", e);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void loadKits();
	}, []);

	useEffect(() => {
		const update = () => setIsHostDarkMode(detectHostDarkMode());
		update();
		const observer = new MutationObserver(update);
		observer.observe(document.body, {
			attributes: true,
			attributeFilter: ["class"],
		});
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class"],
		});
		return () => observer.disconnect();
	}, [detectHostDarkMode]);

	const currentTheme = useMemo(
		() => settings.defaultStyle,
		[settings.defaultStyle],
	);
	const uiThemeMode = settings.uiThemeMode ?? "auto";
	const isUIDark =
		uiThemeMode === "dark" || (uiThemeMode === "auto" && isHostDarkMode);

	const applyKit = async (kitId: string) => {
		try {
			setApplyingKitId(kitId);
			if (onKitApply) {
				await Promise.resolve(onKitApply(kitId));
				return;
			}
			if (!window.zepressReactAPI?.onKitApply) {
				throw new Error("Kit apply API not available");
			}
			await window.zepressReactAPI.onKitApply(kitId);
		} catch (e) {
			logger.error("[TemplateKitSelector] apply kit failed:", e);
		} finally {
			setApplyingKitId("");
		}
	};

	const cleanKitName = (raw: string) =>
		raw
			.replace(/^主题套装\s*[·•]\s*/i, "")
			.replace(/^MP\s*Publisher\s*/i, "")
			.replace(/^MP\s*Pub\s*/i, "")
			.trim();

	const isDefaultKit = (kit: TemplateKit) => {
		const theme = String(kit.styleConfig?.theme || "").toLowerCase();
		const id = String(kit.basicInfo?.id || "").toLowerCase();
		const name = cleanKitName(String(kit.basicInfo?.name || ""));
		return (
			theme === "mpp-default" ||
			id === "kit-mpp-default" ||
			name.includes("默认")
		);
	};

	const orderedKits = useMemo(() => {
		const copied = [...kits];
		copied.sort((a, b) => {
			const aDefault = isDefaultKit(a) ? 0 : 1;
			const bDefault = isDefaultKit(b) ? 0 : 1;
			if (aDefault !== bDefault) return aDefault - bDefault;
			return 0;
		});
		return copied;
	}, [kits]);

	const elevatedCardStyle: React.CSSProperties = {
		borderRadius: "18px",
		border: isUIDark
			? "1px solid #3A3B40"
			: "1px solid rgba(148,163,184,0.24)",
		background: isUIDark
			? "linear-gradient(180deg, #222327 0%, #1F2023 100%)"
			: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.94) 100%)",
		boxShadow: isUIDark
			? "0 14px 24px -18px rgba(0,0,0,0.55), 0 6px 12px -8px rgba(0,0,0,0.45)"
			: "0 24px 48px -30px rgba(15,23,42,0.45), 0 10px 20px -14px rgba(15,23,42,0.28), 0 1px 0 rgba(255,255,255,0.9) inset",
	};

	if (loading) {
		return (
			<div className="w-full p-6 text-center" style={elevatedCardStyle}>
				<Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-[#9CA3AF]" />
				<p
					className={`text-sm ${isUIDark ? "text-slate-400" : "text-[#87867F]"}`}
				>
					正在加载模板套装...
				</p>
			</div>
		);
	}

	if (error) {
		return (
			<div className="w-full p-6 text-center" style={elevatedCardStyle}>
				<AlertCircle className="mx-auto mb-3 h-8 w-8 text-[#D97757]" />
				<p
					className={`mb-4 text-sm ${isUIDark ? "text-slate-400" : "text-[#87867F]"}`}
				>
					{error}
				</p>
				<Button variant="outline" onClick={() => void loadKits()}>
					重试
				</Button>
			</div>
		);
	}

	if (kits.length === 0) {
		return (
			<div className="w-full p-6 text-center" style={elevatedCardStyle}>
				<AlertCircle className="mx-auto mb-3 h-8 w-8 text-[#9CA3AF]" />
				<h3
					className={`mb-2 text-lg font-semibold ${isUIDark ? "text-slate-100" : "text-[#181818]"}`}
				>
					暂无模板套装
				</h3>
				<p
					className={`text-sm ${isUIDark ? "text-slate-400" : "text-[#87867F]"}`}
				>
					当前未配置可用主题套装。
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			{orderedKits.map((kit) => {
				const active = currentTheme === kit.styleConfig.theme;
				const applying = applyingKitId === kit.basicInfo.id;
				const displayName = cleanKitName(kit.basicInfo.name);
				return (
					<div
						key={kit.basicInfo.id}
						className="p-4"
						style={elevatedCardStyle}
					>
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0">
								<div className="mb-1 flex items-center gap-2">
									<Palette
										className={`h-4 w-4 ${isUIDark ? "text-slate-300" : "text-[#7C6FA3]"}`}
									/>
									<h4
										className={`truncate text-sm font-semibold ${isUIDark ? "text-slate-100" : "text-[#181818]"}`}
									>
										{displayName}
									</h4>
									{active && (
										<CheckCircle2 className="h-4 w-4 text-green-600" />
									)}
								</div>
								<p
									className={`mb-1 text-xs ${isUIDark ? "text-slate-400" : "text-[#87867F]"}`}
								>
									主题风格套装
								</p>
								<p
									className={`text-xs ${isUIDark ? "text-slate-500" : "text-[#9CA3AF]"}`}
								>
									主题: {kit.styleConfig.theme}
								</p>
							</div>
							<Button
								size="sm"
								disabled={applying}
								onClick={() => void applyKit(kit.basicInfo.id)}
								className="shrink-0"
							>
								{applying ? "应用中..." : "一键应用"}
							</Button>
						</div>
					</div>
				);
			})}
			<div
				className={`pt-1 text-xs ${isUIDark ? "text-slate-500" : "text-[#9CA3AF]"}`}
			>
				仅保留：套装列表 + 一键应用
			</div>
		</div>
	);
};
