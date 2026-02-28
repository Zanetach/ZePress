import { App } from "obsidian";

function trimSlashes(input: string): string {
	return input.replace(/\/+$/, "").replace(/^\/+/, "");
}

export function resolvePluginDir(app: App, pluginId = "zepress"): string {
	const plugins = (app as any).plugins?.plugins || {};
	const plugin =
		plugins[pluginId] ||
		plugins["zepress"] ||
		plugins["zepress"];
	const manifest = plugin?.manifest;

	const configDir = trimSlashes(String(app.vault.configDir || ".obsidian"));
	const rawDir = String(manifest?.dir || "").replace(/\\/g, "/").replace(/\/+$/, "");
	const manifestId = String(manifest?.id || pluginId || "zepress");

	if (!rawDir) {
		return `${configDir}/plugins/${manifestId}`;
	}

	// Already vault-relative full plugin path (most reliable form).
	if (rawDir.startsWith(`${configDir}/plugins/`)) {
		return rawDir;
	}

	// Relative plugin short form: "zepress" or "plugins/zepress".
	if (!rawDir.includes("/")) {
		return `${configDir}/plugins/${rawDir}`;
	}
	if (rawDir.startsWith("plugins/")) {
		return `${configDir}/${rawDir}`;
	}

	// Absolute-like path: keep only ".../plugins/<id>" tail to avoid duplicated ".obsidian/plugins".
	const marker = "/plugins/";
	const markerIdx = rawDir.lastIndexOf(marker);
	if (markerIdx >= 0) {
		const pluginsTail = rawDir.slice(markerIdx + 1); // "plugins/<id>"
		return `${configDir}/${pluginsTail}`;
	}

	// Fallback: treat as already vault-relative directory.
	return rawDir;
}

export function resolvePluginAssetsDir(app: App, pluginId = "zepress"): string {
	return `${resolvePluginDir(app, pluginId)}/assets`;
}
