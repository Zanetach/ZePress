import React, {useEffect, useState} from "react";
import {TemplateKitSelector} from "./TemplateKitSelector";
import {CoverDesigner} from "./CoverDesigner";
import {LogsPanel} from "./LogsPanel";
import {PlaygroundPanel} from "./PlaygroundPanel";
import {ArticleInfo, ArticleInfoData} from "./ArticleInfo";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "../ui/tabs";
import {ConfigComponent} from "./PluginConfigComponent";
import {PersonalInfoSettings} from "../settings/PersonalInfoSettings";
import {AISettings} from "../settings/AISettings";
import {PersonalInfo, UnifiedPluginData, ViteReactSettings, CloudStorageSettings, defaultCloudStorageSettings, UploadedImage} from "../../types";
import {CoverData} from "@/components/toolbar/CoverData";
import {logger} from "../../../../shared/src/logger";
import {FileText, Package, Plug, Zap, User, Bot, Globe, Image, Palette, Cloud, Eye, EyeOff, AlertCircle, ChevronDown, CheckCircle2, XCircle, Loader2, Upload, Trash2, Copy, ExternalLink, ImagePlus, Heading1, PanelLeftClose} from "lucide-react";

const APP_NAME = "ZePress";

const ZePressLogo = () => (
	<div
		title={APP_NAME}
		className="w-8 h-8 rounded-xl relative overflow-hidden bg-gradient-to-br from-[#6E5BFF] via-[#7A73FF] to-[#44D8FF]"
	>
		<div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.35),_rgba(255,255,255,0))]" />
		<div className="absolute inset-y-0 right-0 w-4 bg-white/20 transform rotate-6 -translate-x-1" />
		<span className="relative z-10 text-[11px] font-semibold tracking-[0.4em] text-white">ZP</span>
	</div>
);

// 七牛云区域配置
const QINIU_REGIONS: Array<{
	value: CloudStorageSettings['qiniu']['region'];
	label: string;
	description: string;
}> = [
	{value: 'z0', label: '华东', description: 'East China (z0)'},
	{value: 'z1', label: '华北', description: 'North China (z1)'},
	{value: 'z2', label: '华南', description: 'South China (z2)'},
	{value: 'na0', label: '北美', description: 'North America (na0)'},
	{value: 'as0', label: '东南亚', description: 'Southeast Asia (as0)'},
];

// 云存储设置组件
const CloudStorageSettingsSection: React.FC<{
	cloudSettings: CloudStorageSettings;
	onSettingsChange: (settings: CloudStorageSettings) => void;
}> = ({cloudSettings, onSettingsChange}) => {
	const [showSecretKey, setShowSecretKey] = useState(false);
	const [expanded, setExpanded] = useState(cloudSettings.enabled);
	const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
	const [testMessage, setTestMessage] = useState('');

	const updateQiniuField = (field: keyof CloudStorageSettings['qiniu'], value: string) => {
		onSettingsChange({
			...cloudSettings,
			qiniu: {...cloudSettings.qiniu, [field]: value}
		});
	};

	const isConfigComplete = cloudSettings.qiniu.accessKey &&
		cloudSettings.qiniu.secretKey &&
		cloudSettings.qiniu.bucket &&
		cloudSettings.qiniu.domain;

	// 测试配置
	const testConnection = async () => {
		if (!isConfigComplete) {
			setTestStatus('error');
			setTestMessage('请先填写所有配置项');
			return;
		}

		setTestStatus('testing');
		setTestMessage('正在测试域名连通性...');

		try {
			// 规范化域名
			let domain = cloudSettings.qiniu.domain.trim();
			if (!domain.startsWith('http://') && !domain.startsWith('https://')) {
				domain = 'https://' + domain;
			}
			domain = domain.replace(/\/$/, '');

			// 使用 Obsidian 的 requestUrl API（如果可用）或 fetch
			const requestUrl = (window as any).zepressReactAPI?.requestUrl;

			if (requestUrl) {
				// Obsidian 环境 - 使用 GET 请求测试
				try {
					const response = await requestUrl({url: domain, method: 'GET'});
					// 任何 HTTP 响应都说明域名可访问（包括 404）
					setTestStatus('success');
					setTestMessage('域名连接正常');
				} catch (reqError: any) {
					// 检查是否是 HTTP 错误（有状态码说明域名可访问）
					if (reqError?.status) {
						setTestStatus('success');
						setTestMessage('域名连接正常');
					} else {
						throw reqError;
					}
				}
			} else {
				// Web 环境 - 简单检查
				setTestStatus('success');
				setTestMessage('配置已保存');
			}
		} catch (error) {
			setTestStatus('error');
			setTestMessage(`测试失败: ${error instanceof Error ? error.message : '未知错误'}`);
		}

		// 5秒后重置状态
		setTimeout(() => {
			setTestStatus('idle');
			setTestMessage('');
		}, 5000);
	};

	return (
		<div className="space-y-3">
			<p className="text-xs text-[#6B7280] uppercase tracking-wide px-1">云存储</p>
			<div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
				{/* 标题栏 - 点击展开/收起 */}
				<div
					className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[#FAFAFA] select-none"
					onClick={() => setExpanded(!expanded)}
				>
					<div className="flex items-center gap-3">
						<div className="w-7 h-7 bg-gradient-to-br from-[#97B5D5] to-[#7095B5] rounded-md flex items-center justify-center">
							<Cloud className="h-4 w-4 text-white"/>
						</div>
						<div>
							<span className="text-[#111827] text-sm block">七牛云存储</span>
							<span className="text-[#6B7280] text-xs">
								{cloudSettings.enabled && isConfigComplete ? '已启用' : cloudSettings.enabled ? '配置不完整' : '点击配置'}
							</span>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<Switch
							checked={cloudSettings.enabled}
							onCheckedChange={(checked) => {
								onSettingsChange({
									...cloudSettings,
									enabled: checked,
									provider: checked ? 'qiniu' : 'local'
								});
								if (checked) setExpanded(true);
							}}
							onClick={(e) => e.stopPropagation()}
						/>
						<ChevronDown
							className={`h-4 w-4 text-[#6B7280] transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
						/>
					</div>
				</div>

				{/* 展开配置区域 */}
				{expanded && (
					<div className="border-t border-[#E5E7EB] p-4 space-y-4 bg-[#FAFAFA]/50">
						{/* 配置不完整警告 */}
						{cloudSettings.enabled && !isConfigComplete && (
							<div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
								<AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0"/>
								<p className="text-xs text-amber-800">
									云存储已启用但配置不完整，请填写以下所有字段
								</p>
							</div>
						)}

						{/* Access Key */}
						<div>
							<label className="block text-xs font-medium text-[#111827] mb-1.5">Access Key</label>
							<input
								type="text"
								value={cloudSettings.qiniu.accessKey}
								onChange={(e) => updateQiniuField('accessKey', e.target.value)}
								placeholder="七牛 Access Key"
								className="w-full px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] placeholder:text-[#6B7280]/50 focus:outline-none focus:border-[#4B5563] focus:ring-1 focus:ring-[#4B5563]"
							/>
						</div>

						{/* Secret Key */}
						<div>
							<label className="block text-xs font-medium text-[#111827] mb-1.5">Secret Key</label>
							<div className="relative">
								<input
									type={showSecretKey ? 'text' : 'password'}
									value={cloudSettings.qiniu.secretKey}
									onChange={(e) => updateQiniuField('secretKey', e.target.value)}
									placeholder="七牛 Secret Key"
									className="w-full px-3 py-2 pr-10 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] placeholder:text-[#6B7280]/50 focus:outline-none focus:border-[#4B5563] focus:ring-1 focus:ring-[#4B5563]"
								/>
								<button
									type="button"
									onClick={() => setShowSecretKey(!showSecretKey)}
									className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#6B7280] hover:text-[#111827] transition-colors"
								>
									{showSecretKey ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}
								</button>
							</div>
							<p className="mt-1 text-[10px] text-[#6B7280]">Secret Key 仅存储在本地</p>
						</div>

						{/* Bucket */}
						<div>
							<label className="block text-xs font-medium text-[#111827] mb-1.5">Bucket 名称</label>
							<input
								type="text"
								value={cloudSettings.qiniu.bucket}
								onChange={(e) => updateQiniuField('bucket', e.target.value)}
								placeholder="存储空间名称"
								className="w-full px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] placeholder:text-[#6B7280]/50 focus:outline-none focus:border-[#4B5563] focus:ring-1 focus:ring-[#4B5563]"
							/>
						</div>

						{/* Domain */}
						<div>
							<label className="block text-xs font-medium text-[#111827] mb-1.5">CDN 域名</label>
							<input
								type="text"
								value={cloudSettings.qiniu.domain}
								onChange={(e) => updateQiniuField('domain', e.target.value)}
								placeholder="https://cdn.example.com"
								className="w-full px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] placeholder:text-[#6B7280]/50 focus:outline-none focus:border-[#4B5563] focus:ring-1 focus:ring-[#4B5563]"
							/>
							<p className="mt-1 text-[10px] text-[#6B7280]">七牛控制台 → 存储空间 → 域名管理</p>
						</div>

						{/* Region */}
						<div>
							<label className="block text-xs font-medium text-[#111827] mb-1.5">存储区域</label>
							<select
								value={cloudSettings.qiniu.region}
								onChange={(e) => updateQiniuField('region', e.target.value)}
								className="w-full px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:outline-none focus:border-[#4B5563] focus:ring-1 focus:ring-[#4B5563] cursor-pointer"
							>
								{QINIU_REGIONS.map((region) => (
									<option key={region.value} value={region.value}>
										{region.label} - {region.description}
									</option>
								))}
							</select>
						</div>

						{/* 测试按钮 */}
						<div className="pt-2 border-t border-[#E5E7EB]">
							<button
								onClick={testConnection}
								disabled={testStatus === 'testing' || !isConfigComplete}
								className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
									testStatus === 'testing'
										? 'bg-[#E5E7EB] text-[#6B7280] cursor-wait'
										: testStatus === 'success'
										? 'bg-green-50 text-green-700 border border-green-200'
										: testStatus === 'error'
										? 'bg-red-50 text-red-700 border border-red-200'
										: isConfigComplete
										? 'bg-[#4B5563] text-white hover:bg-[#374151]'
										: 'bg-[#E5E7EB] text-[#6B7280] cursor-not-allowed'
								}`}
							>
								{testStatus === 'testing' ? (
									<>
										<Loader2 className="h-4 w-4 animate-spin"/>
										测试中...
									</>
								) : testStatus === 'success' ? (
									<>
										<CheckCircle2 className="h-4 w-4"/>
										{testMessage}
									</>
								) : testStatus === 'error' ? (
									<>
										<XCircle className="h-4 w-4"/>
										{testMessage}
									</>
								) : (
									<>
										<Cloud className="h-4 w-4"/>
										测试配置
									</>
								)}
							</button>
							{!isConfigComplete && testStatus === 'idle' && (
								<p className="mt-2 text-[10px] text-[#6B7280] text-center">
									请填写所有必填项后测试
								</p>
							)}
						</div>
							</div>
						)}
					</div>
				</div>
		);
	};

// 七牛云上传区域配置
const QINIU_UPLOAD_HOSTS: Record<CloudStorageSettings['qiniu']['region'], string> = {
	'z0': 'https://up.qiniup.com',
	'z1': 'https://up-z1.qiniup.com',
	'z2': 'https://up-z2.qiniup.com',
	'na0': 'https://up-na0.qiniup.com',
	'as0': 'https://up-as0.qiniup.com',
};

const getStorageScope = (): string => {
	try {
		const app = (window as any)?.app || (window as any)?.parent?.app || (window as any)?.top?.app;
		const vaultName = app?.vault?.getName?.() || app?.vault?.name || 'default-vault';
		const vaultPath = app?.vault?.adapter?.basePath || app?.vault?.adapter?.path || '';
		const raw = `${vaultName}|${vaultPath}`.toLowerCase();
		return raw.replace(/[^a-z0-9|_-]/g, '_');
	} catch {
		return 'default-vault';
	}
};

const getScopedStorageKey = (key: string): string => `${key}::${getStorageScope()}`;

// 本地存储键名
const UPLOADED_IMAGES_STORAGE_KEY = getScopedStorageKey('zepress-uploaded-images');
const TOOLBAR_SECTION_STORAGE_KEY = getScopedStorageKey('zepress-toolbar-section');
const TOOLBAR_PLUGIN_TAB_STORAGE_KEY = getScopedStorageKey('zepress-toolbar-plugin-tab');

// 获取已上传图片列表
const getUploadedImages = (): UploadedImage[] => {
	try {
		const data = localStorage.getItem(UPLOADED_IMAGES_STORAGE_KEY);
		return data ? JSON.parse(data) : [];
	} catch {
		return [];
	}
};

// 保存已上传图片列表
const saveUploadedImages = (images: UploadedImage[]) => {
	localStorage.setItem(UPLOADED_IMAGES_STORAGE_KEY, JSON.stringify(images));
};

// 生成文件 key（七牛云存储路径）
const generateFileKey = (file: File): string => {
	const ext = file.name.split('.').pop() || 'jpg';
	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 8);
	return `zepress/${timestamp}-${random}.${ext}`;
};

// Base64 URL 编码
const base64UrlEncode = (str: string): string => {
	return btoa(str).replace(/\+/g, '-').replace(/\//g, '_');
};

// HMAC-SHA1 签名
const hmacSha1 = async (key: string, message: string): Promise<string> => {
	const encoder = new TextEncoder();
	const keyData = encoder.encode(key);
	const messageData = encoder.encode(message);

	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		keyData,
		{name: 'HMAC', hash: 'SHA-1'},
		false,
		['sign']
	);

	const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
	const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
	return base64.replace(/\+/g, '-').replace(/\//g, '_');
};

// 生成七牛云上传 Token
const generateUploadToken = async (
	accessKey: string,
	secretKey: string,
	bucket: string,
	key: string
): Promise<string> => {
	const deadline = Math.floor(Date.now() / 1000) + 3600; // 1小时有效期
	const putPolicy = {
		scope: `${bucket}:${key}`,
		deadline,
	};
	const encodedPolicy = base64UrlEncode(JSON.stringify(putPolicy));
	const sign = await hmacSha1(secretKey, encodedPolicy);
	return `${accessKey}:${sign}:${encodedPolicy}`;
};

// 云存储面板组件（内容部分，不含标题）
const CloudStoragePanelContent: React.FC<{
	cloudSettings: CloudStorageSettings;
	onSettingsChange: (settings: CloudStorageSettings) => void;
}> = ({cloudSettings, onSettingsChange}) => {
	const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>(() => getUploadedImages());
	const [uploading, setUploading] = useState(false);
	const [uploadProgress, setUploadProgress] = useState(0);
	const [dragOver, setDragOver] = useState(false);
	const fileInputRef = React.useRef<HTMLInputElement>(null);

	// 监听 storage 变化刷新列表
	useEffect(() => {
		const handleStorageChange = () => {
			setUploadedImages(getUploadedImages());
		};
		window.addEventListener('storage', handleStorageChange);
		window.addEventListener('zepress-images-updated', handleStorageChange);
		return () => {
			window.removeEventListener('storage', handleStorageChange);
			window.removeEventListener('zepress-images-updated', handleStorageChange);
		};
	}, []);

	const isConfigComplete = cloudSettings.enabled &&
		cloudSettings.qiniu.accessKey &&
		cloudSettings.qiniu.secretKey &&
		cloudSettings.qiniu.bucket &&
		cloudSettings.qiniu.domain;

	// 上传文件到七牛云
	const uploadToQiniu = async (file: File): Promise<UploadedImage | null> => {
		if (!isConfigComplete) return null;

		const key = generateFileKey(file);
		const token = await generateUploadToken(
			cloudSettings.qiniu.accessKey,
			cloudSettings.qiniu.secretKey,
			cloudSettings.qiniu.bucket,
			key
		);

		const formData = new FormData();
		formData.append('file', file);
		formData.append('token', token);
		formData.append('key', key);

		const uploadHost = QINIU_UPLOAD_HOSTS[cloudSettings.qiniu.region];

		const response = await fetch(uploadHost, {
			method: 'POST',
			body: formData,
		});

		if (!response.ok) {
			throw new Error(`上传失败: ${response.status}`);
		}

		const result = await response.json();
		let domain = cloudSettings.qiniu.domain.trim();
		if (!domain.startsWith('http://') && !domain.startsWith('https://')) {
			domain = 'https://' + domain;
		}
		domain = domain.replace(/\/$/, '');

		const uploadedImage: UploadedImage = {
			id: crypto.randomUUID(),
			name: file.name,
			url: `${domain}/${result.key}`,
			key: result.key,
			size: file.size,
			type: file.type,
			uploadedAt: new Date().toISOString(),
		};

		return uploadedImage;
	};

	// 处理文件上传
	const handleUpload = async (files: FileList | File[]) => {
		if (!isConfigComplete) {
			alert('请先完成云存储配置');
			return;
		}

		const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
		if (imageFiles.length === 0) {
			alert('请选择图片文件');
			return;
		}

		setUploading(true);
		setUploadProgress(0);

		const newImages: UploadedImage[] = [];
		for (let i = 0; i < imageFiles.length; i++) {
			try {
				const image = await uploadToQiniu(imageFiles[i]);
				if (image) {
					newImages.push(image);
				}
			} catch (error) {
				console.error('上传失败:', error);
			}
			setUploadProgress(Math.round(((i + 1) / imageFiles.length) * 100));
		}

		if (newImages.length > 0) {
			const updated = [...newImages, ...uploadedImages];
			setUploadedImages(updated);
			saveUploadedImages(updated);
		}

		setUploading(false);
		setUploadProgress(0);
	};

	// 删除图片记录
	const handleDelete = (id: string) => {
		const updated = uploadedImages.filter(img => img.id !== id);
		setUploadedImages(updated);
		saveUploadedImages(updated);
	};

	// 复制 URL
	const handleCopyUrl = async (url: string) => {
		await navigator.clipboard.writeText(url);
	};

	// 格式化文件大小
	const formatSize = (bytes: number): string => {
		if (bytes < 1024) return bytes + ' B';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
		return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
	};

	// 格式化日期
	const formatDate = (dateStr: string): string => {
		const date = new Date(dateStr);
		return date.toLocaleDateString('zh-CN', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});
	};

	return (
		<>
			{/* 云存储配置 */}
			<CloudStorageSettingsSection
				cloudSettings={cloudSettings}
				onSettingsChange={onSettingsChange}
			/>

			{/* 上传区域 */}
			{isConfigComplete && (
				<div className="space-y-3">
					<p className="text-xs text-[#6B7280] uppercase tracking-wide px-1">上传图片</p>
					<div
						className={`relative border-2 border-dashed rounded-xl p-6 transition-all cursor-pointer ${
							dragOver
								? 'border-[#4B5563] bg-[#4B5563]/5'
								: 'border-[#E5E7EB] hover:border-[#4B5563]/50 bg-white'
						}`}
						onDragOver={(e) => {e.preventDefault(); setDragOver(true);}}
						onDragLeave={() => setDragOver(false)}
						onDrop={(e) => {
							e.preventDefault();
							setDragOver(false);
							handleUpload(e.dataTransfer.files);
						}}
						onClick={() => fileInputRef.current?.click()}
					>
						<input
							ref={fileInputRef}
							type="file"
							accept="image/*"
							multiple
							className="hidden"
							onChange={(e) => e.target.files && handleUpload(e.target.files)}
						/>
						<div className="flex flex-col items-center gap-2">
							{uploading ? (
								<>
									<Loader2 className="h-8 w-8 text-[#4B5563] animate-spin"/>
									<p className="text-sm text-[#111827]">上传中 {uploadProgress}%</p>
								</>
							) : (
								<>
									<ImagePlus className="h-8 w-8 text-[#6B7280]"/>
									<p className="text-sm text-[#111827]">点击或拖拽图片到这里</p>
									<p className="text-xs text-[#6B7280]">支持 JPG、PNG、GIF 等格式</p>
								</>
							)}
						</div>
					</div>
				</div>
			)}

			{/* 已上传图片列表 */}
			{uploadedImages.length > 0 && (
				<div className="space-y-3">
					<div className="flex items-center justify-between px-1">
						<p className="text-xs text-[#6B7280] uppercase tracking-wide">已上传 ({uploadedImages.length})</p>
						<button
							onClick={() => {
								if (confirm('确定清空所有上传记录吗？')) {
									setUploadedImages([]);
									saveUploadedImages([]);
								}
							}}
							className="text-xs text-[#6B7280] hover:text-red-500 transition-colors"
						>
							清空
						</button>
					</div>
					<div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
						<div className="divide-y divide-[#E5E7EB] max-h-[300px] overflow-y-auto">
							{uploadedImages.map((img) => (
								<div key={img.id} className="flex items-center gap-3 p-3 hover:bg-[#FAFAFA]">
									<img
										src={img.url}
										alt={img.name}
										className="w-12 h-12 object-cover rounded-lg flex-shrink-0"
									/>
									<div className="flex-1 min-w-0">
										<p className="text-sm text-[#111827] truncate">{img.name}</p>
										<p className="text-xs text-[#6B7280]">
											{formatSize(img.size)} · {formatDate(img.uploadedAt)}
										</p>
									</div>
									<div className="flex items-center gap-1">
										<button
											onClick={() => handleCopyUrl(img.url)}
											className="p-1.5 rounded-md text-[#6B7280] hover:bg-[#E5E7EB] hover:text-[#111827] transition-all"
											title="复制链接"
										>
											<Copy className="h-4 w-4"/>
										</button>
										<a
											href={img.url}
											target="_blank"
											rel="noopener noreferrer"
											className="p-1.5 rounded-md text-[#6B7280] hover:bg-[#E5E7EB] hover:text-[#111827] transition-all"
											title="打开"
										>
											<ExternalLink className="h-4 w-4"/>
										</a>
										<button
											onClick={() => handleDelete(img.id)}
											className="p-1.5 rounded-md text-[#6B7280] hover:bg-red-50 hover:text-red-500 transition-all"
											title="删除"
										>
											<Trash2 className="h-4 w-4"/>
										</button>
									</div>
								</div>
							))}
						</div>
					</div>
				</div>
			)}

			{/* 未配置提示 */}
			{!isConfigComplete && (
				<div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
					<AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0"/>
					<p className="text-xs text-amber-800">
						请先启用并完成七牛云配置，然后即可上传图片
					</p>
				</div>
			)}
		</>
	);
};

import JSZip from 'jszip';
import {Checkbox} from "../ui/checkbox";
import {Switch} from "../ui/switch";
import {useSettings} from "../../hooks/useSettings";

// Unified section layout for all menu panels - DRY
const SectionLayout: React.FC<{
	title: string;
	children: React.ReactNode;
	withCard?: boolean;
	isDark?: boolean;
	collapsed?: boolean;
}> = ({ title, children, withCard = true, isDark = false, collapsed = false }) => (
	<div className="space-y-4">
		<div className="flex items-center justify-between">
			<h3 className={`text-lg font-semibold ${isDark ? 'text-[#E5E7EB]' : 'text-[#111827]'}`}>{title}</h3>
			{collapsed && (
				<span className={`text-xs ${isDark ? 'text-[#94A3B8]' : 'text-[#6B7280]'}`}>已折叠</span>
			)}
		</div>
		{!collapsed && (
			withCard ? (
				<div className={`rounded-xl border p-4 shadow-sm ${isDark ? 'bg-[#222327] border-[#3A3B40]' : 'bg-white border-[#E5E7EB]'}`}>
					{children}
				</div>
			) : children
		)}
	</div>
);

interface ToolbarProps {
	settings: ViteReactSettings;
	isUIDark?: boolean;
	plugins: UnifiedPluginData[];
	articleHTML: string;
	onTemplateChange: (template: string) => void;
	onThemeChange: (theme: string) => void;
	onHighlightChange: (highlight: string) => void;
	onThemeColorToggle: (enabled: boolean) => void;
	onThemeColorChange: (color: string) => void;
	onRenderArticle: () => void;
	onSaveSettings: () => void;
	onPluginToggle?: (pluginName: string, enabled: boolean) => void;
	onPluginConfigChange?: (pluginName: string, key: string, value: string | boolean) => void;
	onArticleInfoChange?: (info: ArticleInfoData) => void;
	onPersonalInfoChange?: (info: PersonalInfo) => void;
	onSettingsChange?: (settings: Partial<ViteReactSettings>) => void;
	onKitApply?: (kitId: string) => void;
	onKitCreate?: (basicInfo: any) => void;
	onKitDelete?: (kitId: string) => void;
	isContentCollapsed?: boolean;
	onToggleToolbar?: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
													settings,
													isUIDark = false,
													plugins,
													articleHTML,
													onTemplateChange,
													onThemeChange,
													onHighlightChange,
													onThemeColorToggle,
													onThemeColorChange,
													onRenderArticle,
													onSaveSettings,
													onPluginToggle,
													onPluginConfigChange,
													onArticleInfoChange,
													onPersonalInfoChange,
													onSettingsChange,
													onKitApply,
													onKitCreate,
													onKitDelete,
													isContentCollapsed = false,
													onToggleToolbar,
												}) => {

	// 使用 useSettings hook 获取设置更新方法
	const {settings: atomSettings, updateSettings, saveSettings} = useSettings(onSaveSettings, onPersonalInfoChange, onSettingsChange);

	// 统一的导航状态 - 苹果风格侧边栏
	type NavSection = 'article' | 'cover' | 'kits' | 'plugins' | 'playground' | 'logs' | 'cloud' | 'personal' | 'ai' | 'general';
	const [activeSection, setActiveSection] = useState<NavSection>(() => {
		try {
			const saved = localStorage.getItem(TOOLBAR_SECTION_STORAGE_KEY) as NavSection;
			return saved || 'article';
		} catch {
			return 'article';
		}
	});

	const handleSectionChange = (section: NavSection) => {
		if (isContentCollapsed) {
			onToggleToolbar?.();
		}
		setActiveSection(section);
		try {
			localStorage.setItem(TOOLBAR_SECTION_STORAGE_KEY, section);
		} catch {}
	};
	const showStyleUI = atomSettings.showStyleUI !== false;
	useEffect(() => {
		if (!showStyleUI && activeSection === "kits") {
			handleSectionChange("article");
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [showStyleUI, activeSection]);

	// 插件管理中的子tab状态
	const [pluginTab, setPluginTab] = useState<string>(() => {
		try {
			const saved = localStorage.getItem(TOOLBAR_PLUGIN_TAB_STORAGE_KEY);
			if (saved) return saved;
		} catch {}
		return plugins.some(p => p.type === 'rehype') ? 'rehype' : 'remark';
	});

	// 插件展开状态管理
	const [pluginExpandedSections, setPluginExpandedSections] = useState<string[]>(
		settings.expandedAccordionSections || []
	);

	// 通用开关的本地状态，避免“更新+立即保存”导致的回弹
	const [scaleCodeBlockEnabled, setScaleCodeBlockEnabled] = useState<boolean>(atomSettings.scaleCodeBlockInImage ?? true);
	const [hideFirstHeadingEnabled, setHideFirstHeadingEnabled] = useState<boolean>(atomSettings.hideFirstHeading ?? false);
	const [showCoverEnabled, setShowCoverEnabled] = useState<boolean>(atomSettings.showCoverInArticle ?? true);
	const [imageSaveFolderEnabled, setImageSaveFolderEnabled] = useState<boolean>(atomSettings.imageSaveFolderEnabled ?? true);

	useEffect(() => {
		setScaleCodeBlockEnabled(atomSettings.scaleCodeBlockInImage ?? true);
	}, [atomSettings.scaleCodeBlockInImage]);

	useEffect(() => {
		setHideFirstHeadingEnabled(atomSettings.hideFirstHeading ?? false);
	}, [atomSettings.hideFirstHeading]);

	useEffect(() => {
		setShowCoverEnabled(atomSettings.showCoverInArticle ?? true);
	}, [atomSettings.showCoverInArticle]);

	useEffect(() => {
		setImageSaveFolderEnabled(atomSettings.imageSaveFolderEnabled ?? true);
	}, [atomSettings.imageSaveFolderEnabled]);

	const persistSettingChange = (next: Partial<ViteReactSettings>) => {
		updateSettings(next);
		requestAnimationFrame(() => saveSettings());
	};

	// 同步插件展开状态
	useEffect(() => {
		setPluginExpandedSections(settings.expandedAccordionSections || []);
	}, [settings.expandedAccordionSections]);

	const remarkPlugins = plugins.filter(p => p.type === 'remark');
	const rehypePlugins = plugins.filter(p => p.type === 'rehype');

	const handleBatchToggle = (pluginType: 'remark' | 'rehype', enabled: boolean) => {
		(pluginType === 'remark' ? remarkPlugins : rehypePlugins)
			.forEach(plugin => onPluginToggle?.(plugin.name, enabled));
		onRenderArticle();
	};

	// 计算插件的全选状态
	const getPluginsCheckState = (plugins: UnifiedPluginData[]): boolean | 'indeterminate' => {
		const enabledCount = plugins.filter(p => p.enabled).length;
		if (enabledCount === 0) return false;
		if (enabledCount === plugins.length) return true;
		return 'indeterminate';
	};

	// 处理全选checkbox点击
	const handleSelectAllToggle = (pluginType: 'remark' | 'rehype') => {
		const plugins = pluginType === 'remark' ? remarkPlugins : rehypePlugins;
		const currentState = getPluginsCheckState(plugins);
		// 如果当前是全选或部分选中，则取消全选；如果是全不选，则全选
		const newState = currentState === false;
		handleBatchToggle(pluginType, newState);
	};

	// 处理插件展开/折叠
	const handlePluginToggle = (sectionId: string, isExpanded: boolean) => {
		let newSections: string[];
		if (isExpanded) {
			newSections = pluginExpandedSections.includes(sectionId)
				? pluginExpandedSections
				: [...pluginExpandedSections, sectionId];
		} else {
			newSections = pluginExpandedSections.filter(id => id !== sectionId);
		}

		// 更新本地状态
		setPluginExpandedSections(newSections);
		onSaveSettings();
	};

	// 获取图片数据的通用函数
	const getImageArrayBuffer = async (imageUrl: string): Promise<ArrayBuffer> => {
		if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
			// HTTP/HTTPS URL - 使用Obsidian的requestUrl API
			const globalAPI = (window as any).zepressReactAPI;
			if (!globalAPI || typeof globalAPI.requestUrl === 'undefined') {
				throw new Error('此功能仅在Obsidian环境中可用');
			}
			const requestUrl = globalAPI.requestUrl;
			const response = await requestUrl({url: imageUrl, method: 'GET'});
			return response.arrayBuffer;
		} else if (imageUrl.startsWith('blob:') || imageUrl.startsWith('data:')) {
			// Blob URL 或 Data URL - 使用fetch API
			const response = await fetch(imageUrl);
			if (!response.ok) {
				throw new Error(`Failed to fetch image: ${response.status}`);
			}
			return await response.arrayBuffer();
		} else {
			throw new Error(`不支持的URL协议: ${imageUrl}`);
		}
	};

	// 使用zip打包下载所有封面
	const downloadWithBrowserDownload = async (covers: CoverData[]) => {
		const cover1 = covers.find(c => c.aspectRatio === '2.25:1');
		const cover2 = covers.find(c => c.aspectRatio === '1:1');

		try {
			const zip = new JSZip();
			let fileCount = 0;

			// 添加单独的封面到zip
			for (const [index, cover] of covers.entries()) {
				try {
					const arrayBuffer = await getImageArrayBuffer(cover.imageUrl);
					const aspectStr = cover.aspectRatio.replace(':', '-').replace('.', '_');
					const fileName = `zepress-cover-${index + 1}-${aspectStr}.jpg`;
					zip.file(fileName, arrayBuffer);
					fileCount++;
				} catch (error) {
					console.error(`准备封面 ${index + 1} 失败:`, error);
				}
			}

			// 如果有两个封面，添加拼接图到zip
			if (cover1 && cover2) {
				try {
					const combinedBlob = await createCombinedCoverBlob(cover1, cover2);
					const arrayBuffer = await combinedBlob.arrayBuffer();
					const fileName = 'zepress-cover-combined-3_25_1.jpg';
					zip.file(fileName, arrayBuffer);
					fileCount++;
				} catch (error) {
					console.error("准备拼接封面失败:", error);
				}
			}

			if (fileCount === 0) {
				alert('没有有效的封面可以下载');
				return;
			}

			// 生成zip文件
			const zipBlob = await zip.generateAsync({type: 'blob'});

			// 创建下载链接
			const url = URL.createObjectURL(zipBlob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `zepress-covers-${Date.now()}.zip`;
			a.style.display = 'none';

			document.body.appendChild(a);
			a.click();

			// 清理
			setTimeout(() => {
				// document.body.removeChild(a);
				// URL.revokeObjectURL(url);
			}, 2000);


		} catch (error) {
			console.error('创建zip文件失败:', error);
			alert('下载失败，请重试');
		}
	};

	// 处理封面下载
	const handleDownloadCovers = async (covers: CoverData[]) => {
		logger.info("[Toolbar] 下载封面", {count: covers.length});
		// 直接使用简单的下载方式，避免复杂的弹窗和权限问题
		await downloadWithBrowserDownload(covers);
	};

	// 创建拼接封面Blob的通用函数
	const createCombinedCoverBlob = async (cover1: CoverData, cover2: CoverData): Promise<Blob> => {
		// 下载两张图片的数据
		const [arrayBuffer1, arrayBuffer2] = await Promise.all([
			getImageArrayBuffer(cover1.imageUrl),
			getImageArrayBuffer(cover2.imageUrl)
		]);

		// 创建blob URL
		const blob1 = new Blob([arrayBuffer1], {type: 'image/jpeg'});
		const blob2 = new Blob([arrayBuffer2], {type: 'image/jpeg'});
		const url1 = URL.createObjectURL(blob1);
		const url2 = URL.createObjectURL(blob2);

		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');

		// 设置画布尺寸 (3.25:1 比例，高度600px，提高分辨率)
		const height = 600;
		const width = height * 3.25;
		canvas.width = width;
		canvas.height = height;

		// 加载图片
		const img1 = document.createElement('img');
		const img2 = document.createElement('img');

		const loadImage = (img: HTMLImageElement, url: string): Promise<void> => {
			return new Promise((resolve, reject) => {
				img.onload = () => resolve();
				img.onerror = reject;
				img.src = url;
			});
		};

		await Promise.all([
			loadImage(img1, url1),
			loadImage(img2, url2)
		]);

		// 绘制第一张图 (2.25:1 比例)
		const img1Width = height * 2.25;
		ctx?.drawImage(img1, 0, 0, img1Width, height);

		// 绘制第二张图 (1:1 比例)
		const img2Width = height;
		ctx?.drawImage(img2, img1Width, 0, img2Width, height);

		// 清理blob URL
		URL.revokeObjectURL(url1);
		URL.revokeObjectURL(url2);

		// 转换为blob
		return new Promise((resolve) => {
			canvas.toBlob((blob) => {
				resolve(blob!);
			}, 'image/jpeg', 0.95);
		});
	};

	// 导航菜单配置
	const navItems: {key: typeof activeSection; label: string; icon: React.ElementType; color: string; group: 'content' | 'settings'}[] = [
		{key: 'article', label: '文章信息', icon: FileText, color: 'from-[#9CA3AF] to-[#6B7280]', group: 'content'},
		{key: 'cover', label: '封面设计', icon: Palette, color: 'from-[#9CA3AF] to-[#6B7280]', group: 'content'},
		...(showStyleUI ? [{key: 'kits' as const, label: '模板套装', icon: Package, color: 'from-[#9CA3AF] to-[#6B7280]', group: 'content' as const}] : []),
		{key: 'plugins', label: '插件管理', icon: Plug, color: 'from-[#9CA3AF] to-[#6B7280]', group: 'content'},
		{key: 'playground', label: '生图', icon: ImagePlus, color: 'from-[#9CA3AF] to-[#6B7280]', group: 'content'},
		{key: 'logs', label: 'AI 日志', icon: FileText, color: 'from-[#9CA3AF] to-[#6B7280]', group: 'content'},
		{key: 'cloud', label: '云存储', icon: Cloud, color: 'from-[#9CA3AF] to-[#6B7280]', group: 'settings'},
		{key: 'personal', label: '个人信息', icon: User, color: 'from-[#9CA3AF] to-[#6B7280]', group: 'settings'},
		{key: 'ai', label: 'AI 设置', icon: Bot, color: 'from-[#9CA3AF] to-[#6B7280]', group: 'settings'},
		{key: 'general', label: '通用', icon: Globe, color: 'from-[#9CA3AF] to-[#6B7280]', group: 'settings'},
	];

	try {
		return (
			<div
				id="zepress-toolbar-container"
				data-ui-dark={isUIDark ? "true" : "false"}
				className={`h-full flex relative ${isUIDark ? 'bg-[#1F2023]' : 'bg-[#FAFAFA]'}`}
				style={{
					minWidth: '0',
					width: '100%',
					maxWidth: '100%',
					overflow: 'hidden',
					boxSizing: 'border-box'
				}}>
				{/* 左侧导航栏 - 图标模式 */}
				<div
					className={`backdrop-blur-xl border-r flex flex-col flex-shrink-0 overflow-hidden ${
						isUIDark ? 'bg-[#222327] border-[#3A3B40]' : 'bg-[#F3F4F6]/90 border-[#E5E7EB]'
					}`}
					style={{ width: 56 }}
				>
					{/* 顶部品牌区域 */}
					<div className="h-12 flex items-center justify-center">
						<ZePressLogo />
					</div>
					<div className="h-10 flex items-center justify-center">
						<button
							onClick={() => onToggleToolbar?.()}
							title={isContentCollapsed ? "展开配置栏" : "收起配置栏"}
							className={`w-7 h-7 inline-flex items-center justify-center rounded-md border ${
								isUIDark
									? 'border-[#3A3B40] text-[#CBD5E1] hover:bg-[#2A2B30]'
									: 'border-[#E5E7EB] text-[#374151] hover:bg-[#F3F4F6]'
							}`}
						>
							<PanelLeftClose
								className={`h-4 w-4 transition-transform ${
									isContentCollapsed ? 'rotate-180' : ''
								}`}
							/>
						</button>
					</div>

					<div className="flex-1 overflow-y-auto py-2 px-1.5">
						<div className="mb-3">
							<nav className="space-y-1">
								{navItems.filter(item => item.group === 'content').map(({key, label, icon: Icon}) => (
									<button
										key={key}
										onClick={() => handleSectionChange(key)}
										title={label}
										className={`group relative w-full flex items-center justify-center h-9 px-1.5 rounded-md transition-colors ${
											activeSection === key
												? (isUIDark ? 'text-[#F3F4F6]' : 'text-[#111827]')
												: (isUIDark ? 'text-[#9CA3AF] hover:text-[#CBD5E1]' : 'text-[#6B7280] hover:text-[#374151]')
										}`}
									>
										<Icon className={`h-4 w-4 ${activeSection === key ? (isUIDark ? 'text-[#F3F4F6]' : 'text-[#111827]') : (isUIDark ? 'text-[#9CA3AF] group-hover:text-[#CBD5E1]' : 'text-[#6B7280] group-hover:text-[#374151]')}`}/>
										{key === 'plugins' && plugins.length > 0 && (
											<span className={`absolute -top-0.5 -right-0.5 text-[9px] min-w-4 h-4 px-1 rounded-full flex items-center justify-center ${
												activeSection === key ? 'bg-white/25 text-white' : isUIDark ? 'bg-[#3A3B40] text-[#CBD5E1]' : 'bg-[#E5E7EB] text-[#6B7280]'
											}`}>
												{plugins.length}
											</span>
										)}
									</button>
								))}
							</nav>
						</div>

						{/* 设置分组 */}
						<div>
							<nav className="space-y-1">
								{navItems.filter(item => item.group === 'settings').map(({key, label, icon: Icon}) => (
									<button
										key={key}
										onClick={() => handleSectionChange(key)}
										title={label}
										className={`group w-full flex items-center justify-center h-9 px-1.5 rounded-md transition-colors ${
											activeSection === key
												? (isUIDark ? 'text-[#F3F4F6]' : 'text-[#111827]')
												: (isUIDark ? 'text-[#9CA3AF] hover:text-[#CBD5E1]' : 'text-[#6B7280] hover:text-[#374151]')
										}`}
									>
										<Icon className={`h-4 w-4 ${activeSection === key ? (isUIDark ? 'text-[#F3F4F6]' : 'text-[#111827]') : (isUIDark ? 'text-[#9CA3AF] group-hover:text-[#CBD5E1]' : 'text-[#6B7280] group-hover:text-[#374151]')}`}/>
									</button>
								))}
							</nav>
						</div>
					</div>
				</div>

					{/* 右侧内容区 - 可单独折叠，左侧图标栏保持显示 */}
					{!isContentCollapsed && (
					<div id="zepress-toolbar-content" className={`flex-1 min-w-0 overflow-y-auto relative ${isUIDark ? 'bg-[#1F2023]' : 'bg-[#FAFAFA]'}`}>
					<div className="p-4 sm:p-5">
						{/* 文章信息 */}
						{activeSection === 'article' && (
							<SectionLayout title="文章信息" isDark={isUIDark}>
								<ArticleInfo
									settings={atomSettings}
									onSaveSettings={onSaveSettings}
									onInfoChange={onArticleInfoChange || (() => {})}
									onRenderArticle={onRenderArticle}
									onSettingsChange={onSettingsChange}
									onOpenAISettings={() => handleSectionChange('ai')}
								/>
							</SectionLayout>
						)}

						{/* 封面设计 */}
						{activeSection === 'cover' && (
							<SectionLayout title="封面设计" withCard={false} isDark={isUIDark}>
								<CoverDesigner
									articleHTML={articleHTML}
									onDownloadCovers={handleDownloadCovers}
									onClose={() => {}}
									settings={atomSettings}
									isUIDark={isUIDark}
									onOpenAISettings={() => handleSectionChange('ai')}
								/>
							</SectionLayout>
						)}

						{/* 模板套装 */}
						{showStyleUI && activeSection === 'kits' && (
							<SectionLayout title="模板套装" isDark={isUIDark}>
								<TemplateKitSelector
									settings={settings}
									onKitApply={onKitApply}
									onKitCreate={onKitCreate}
									onKitDelete={onKitDelete}
									onSettingsChange={onSettingsChange}
									onTemplateChange={onTemplateChange}
									onThemeChange={onThemeChange}
									onHighlightChange={onHighlightChange}
									onThemeColorToggle={onThemeColorToggle}
									onThemeColorChange={onThemeColorChange}
								/>
							</SectionLayout>
						)}

						{/* 插件管理 */}
						{activeSection === 'plugins' && (
							<SectionLayout title="插件管理" isDark={isUIDark}>
								{plugins.length > 0 ? (
									<Tabs value={pluginTab} onValueChange={(value) => {
										setPluginTab(value);
										try {
											localStorage.setItem(TOOLBAR_PLUGIN_TAB_STORAGE_KEY, value);
										} catch {}
									}}>
										<TabsList className="bg-muted rounded-xl p-0.5 mb-4 w-full sm:w-auto">
											{remarkPlugins.length > 0 && (
												<TabsTrigger value="remark"
													className="flex items-center gap-1 sm:gap-1.5 text-xs data-[state=active]:bg-card data-[state=active]:shadow-sm data-[state=active]:text-primary text-muted-foreground px-2 sm:px-3 py-1.5 rounded-lg flex-1 sm:flex-none">
													<Plug className="h-3.5 w-3.5 shrink-0"/>
													<span className="hidden sm:inline">Remark</span>
													<span className="bg-accent text-accent-foreground text-[10px] px-1.5 py-0.5 rounded-full">{remarkPlugins.length}</span>
												</TabsTrigger>
											)}
											{rehypePlugins.length > 0 && (
												<TabsTrigger value="rehype"
													className="flex items-center gap-1 sm:gap-1.5 text-xs data-[state=active]:bg-card data-[state=active]:shadow-sm data-[state=active]:text-primary text-muted-foreground px-2 sm:px-3 py-1.5 rounded-lg flex-1 sm:flex-none">
													<Zap className="h-3.5 w-3.5 shrink-0"/>
													<span className="hidden sm:inline">Rehype</span>
													<span className="bg-secondary text-secondary-foreground text-[10px] px-1.5 py-0.5 rounded-full">{rehypePlugins.length}</span>
												</TabsTrigger>
											)}
										</TabsList>

										{remarkPlugins.length > 0 && (
											<TabsContent value="remark" className="mt-0">
												<div className="space-y-3">
													<div className="flex items-center p-2.5 sm:p-3 bg-muted border border-border rounded-lg gap-2 sm:gap-2.5">
														<Checkbox
															checked={getPluginsCheckState(remarkPlugins)}
															onCheckedChange={() => handleSelectAllToggle('remark')}
															className="border-primary data-[state=checked]:bg-primary shrink-0"
														/>
														<div className="min-w-0">
															<h4 className="font-medium text-foreground text-sm truncate">全选 Remark</h4>
															<p className="text-xs text-muted-foreground truncate">Markdown 语法解析插件</p>
														</div>
													</div>
													<div className="space-y-1">
														{remarkPlugins.map(plugin =>
															<ConfigComponent key={plugin.name} item={plugin} type="plugin"
																expandedSections={pluginExpandedSections} onToggle={handlePluginToggle}
																onEnabledChange={(name, enabled) => onPluginToggle?.(name, enabled)}
																onConfigChange={async (name, key, value) => {
																	onPluginConfigChange && await onPluginConfigChange(name, key, value);
																	onRenderArticle();
																}}/>
														)}
													</div>
												</div>
											</TabsContent>
										)}

										{rehypePlugins.length > 0 && (
											<TabsContent value="rehype" className="mt-0">
												<div className="space-y-3">
													<div className="flex items-center p-2.5 sm:p-3 bg-muted border border-border rounded-lg gap-2 sm:gap-2.5">
														<Checkbox
															checked={getPluginsCheckState(rehypePlugins)}
															onCheckedChange={() => handleSelectAllToggle('rehype')}
															className="border-primary data-[state=checked]:bg-primary shrink-0"
														/>
														<div className="min-w-0">
															<h4 className="font-medium text-foreground text-sm truncate">全选 Rehype</h4>
															<p className="text-xs text-muted-foreground truncate">HTML 处理和转换插件</p>
														</div>
													</div>
													<div className="space-y-1">
														{rehypePlugins.map(plugin =>
															<ConfigComponent key={plugin.name} item={plugin} type="plugin"
																expandedSections={pluginExpandedSections} onToggle={handlePluginToggle}
																onEnabledChange={(name, enabled) => onPluginToggle?.(name, enabled)}
																onConfigChange={async (name, key, value) => {
																	onPluginConfigChange && await onPluginConfigChange(name, key, value);
																	onRenderArticle();
																}}/>
														)}
													</div>
												</div>
											</TabsContent>
										)}
									</Tabs>
								) : (
									<div className="text-center py-8">
										<Plug className="h-10 w-10 text-muted-foreground mx-auto mb-3"/>
										<h4 className="font-medium text-foreground mb-1">暂无插件</h4>
										<p className="text-sm text-muted-foreground">当前没有可用的 Markdown 处理插件</p>
									</div>
								)}
							</SectionLayout>
						)}

						{/* 个人信息 */}
						{activeSection === 'personal' && (
							<SectionLayout title="个人信息" isDark={isUIDark}>
								<PersonalInfoSettings
									onClose={() => handleSectionChange('article')}
									onPersonalInfoChange={onPersonalInfoChange}
									onSaveSettings={onSaveSettings}
								/>
							</SectionLayout>
						)}

						{/* AI 设置 */}
						{activeSection === 'ai' && (
							<SectionLayout title="AI 设置" isDark={isUIDark}>
								<AISettings
									onClose={() => handleSectionChange('article')}
									onSettingsChange={onSettingsChange}
									onSaveSettings={onSaveSettings}
								/>
							</SectionLayout>
						)}

						{/* 云存储 */}
						{activeSection === 'cloud' && (
							<SectionLayout title="云存储" withCard={false} isDark={isUIDark}>
								<CloudStoragePanelContent
									cloudSettings={atomSettings.cloudStorage ?? defaultCloudStorageSettings}
									onSettingsChange={(newCloudSettings) => {
										updateSettings({cloudStorage: newCloudSettings});
										saveSettings();
									}}
								/>
							</SectionLayout>
						)}

						{/* 生图 Playground */}
						{activeSection === 'playground' && (
							<SectionLayout title="生图" isDark={isUIDark}>
								<PlaygroundPanel
									settings={atomSettings}
									onOpenAISettings={() => handleSectionChange('ai')}
								/>
							</SectionLayout>
						)}

						{/* AI 日志 */}
						{activeSection === 'logs' && (
							<SectionLayout title="AI 日志" isDark={isUIDark}>
								<LogsPanel/>
							</SectionLayout>
						)}

						{/* 通用设置 */}
						{activeSection === 'general' && (
							<SectionLayout title="通用" withCard={false} isDark={isUIDark}>
								{/* 设置卡片组 */}
								<div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
									<div className="divide-y divide-[#E5E7EB]">
										{/* 代码块缩放 */}
										<div className="flex items-center justify-between px-4 py-3">
											<div className="flex items-center gap-3">
												<div className="w-7 h-7 bg-gradient-to-br from-[#629A90] to-[#4A7A70] rounded-md flex items-center justify-center">
													<Image className="h-4 w-4 text-white"/>
												</div>
												<div>
													<span className="text-[#111827] text-sm block">代码块自动缩放</span>
													<span className="text-[#6B7280] text-xs">复制图片时自动适配</span>
												</div>
											</div>
											<Switch
												checked={scaleCodeBlockEnabled}
												onCheckedChange={(checked) => {
													setScaleCodeBlockEnabled(checked);
													persistSettingChange({scaleCodeBlockInImage: checked});
												}}
											/>
										</div>

										{/* 隐藏一级标题 */}
										<div className="flex items-center justify-between px-4 py-3">
											<div className="flex items-center gap-3">
												<div className="w-7 h-7 bg-gradient-to-br from-[#8B7CB8] to-[#6B5C98] rounded-md flex items-center justify-center">
													<Heading1 className="h-4 w-4 text-white"/>
												</div>
												<div>
													<span className="text-[#111827] text-sm block">隐藏一级标题</span>
													<span className="text-[#6B7280] text-xs">渲染时移除首个 H1</span>
												</div>
											</div>
											<Switch
												checked={hideFirstHeadingEnabled}
												onCheckedChange={(checked) => {
													setHideFirstHeadingEnabled(checked);
													persistSettingChange({hideFirstHeading: checked});
													onRenderArticle?.();
												}}
											/>
										</div>

										{/* 显示封面 */}
										<div className="flex items-center justify-between px-4 py-3">
											<div className="flex items-center gap-3">
												<div className="w-7 h-7 bg-gradient-to-br from-[#B49FD8] to-[#8B7CB8] rounded-md flex items-center justify-center">
													<Image className="h-4 w-4 text-white"/>
												</div>
												<div>
													<span className="text-[#111827] text-sm block">显示封面</span>
													<span className="text-[#6B7280] text-xs">在文章开头显示封面图</span>
												</div>
											</div>
											<Switch
												checked={showCoverEnabled}
												onCheckedChange={(checked) => {
													setShowCoverEnabled(checked);
													persistSettingChange({showCoverInArticle: checked});
													onRenderArticle?.();
												}}
											/>
										</div>

										{/* 生图保存目录 */}
										<div className="px-4 py-3">
											<div className="flex items-center justify-between mb-2">
												<div className="flex items-center gap-3">
												<div className="w-7 h-7 bg-gradient-to-br from-[#C2C07D] to-[#A2A05D] rounded-md flex items-center justify-center">
													<Image className="h-4 w-4 text-white"/>
												</div>
												<div>
													<span className="text-[#111827] text-sm block">生图保存目录</span>
													<span className="text-[#6B7280] text-xs">生图“保存到笔记”使用该目录</span>
												</div>
												</div>
												<Switch
													checked={imageSaveFolderEnabled}
													onCheckedChange={(checked) => {
														setImageSaveFolderEnabled(checked);
														persistSettingChange({imageSaveFolderEnabled: checked});
													}}
												/>
											</div>
											<input
												type="text"
												value={atomSettings.imageSaveFolder ?? "zepress-images"}
												onChange={(e) => persistSettingChange({imageSaveFolder: e.target.value})}
												disabled={!imageSaveFolderEnabled}
												placeholder="例如：attachments/ai-images"
												className="w-full px-3 py-2 bg-[#FAFAFA] border border-[#E5E7EB] rounded-lg text-sm text-[#111827] placeholder:text-[#6B7280]/60 focus:outline-none focus:border-[#4B5563] focus:ring-1 focus:ring-[#4B5563] disabled:opacity-50 disabled:cursor-not-allowed"
											/>
										</div>
									</div>
								</div>

								{/* 即将推出 */}
								<div>
									<p className="text-xs text-[#6B7280] uppercase tracking-wide px-1 mb-2">即将推出</p>
									<div className="bg-white/60 rounded-xl border border-[#E5E7EB] overflow-hidden">
										<div className="divide-y divide-[#E5E7EB]">
											{[
												{label: '主题', desc: '明亮 / 暗色', color: 'from-[#B49FD8] to-[#8B7CB8]'},
												{label: '语言', desc: '简体中文', color: 'from-[#97B5D5] to-[#7095B5]'},
												{label: '快捷键', desc: '自定义', color: 'from-[#C2C07D] to-[#A2A05D]'},
												{label: '数据', desc: '导入 / 导出', color: 'from-[#4B5563] to-[#AC583C]'}
											].map((item, i) => (
												<div key={i} className="flex items-center justify-between px-4 py-3 opacity-50">
													<div className="flex items-center gap-3">
														<div className={`w-7 h-7 bg-gradient-to-br ${item.color} rounded-md`}/>
														<span className="text-[#111827] text-sm">{item.label}</span>
													</div>
													<span className="text-[#6B7280] text-xs">{item.desc}</span>
												</div>
											))}
										</div>
									</div>
								</div>
							</SectionLayout>
							)}
						</div>
					</div>
						)}
					</div>
		);
	} catch (error) {
		logger.error("[Toolbar] 完整工具栏渲染错误:", error);
		return (
			<div className="h-full flex flex-col bg-[#FAFAFA] p-6">
				<div className="bg-white border border-[#E5E7EB] rounded-2xl p-6">
					<h3 className="text-lg font-semibold text-[#4B5563] mb-2">完整工具栏渲染失败</h3>
					<p className="text-sm text-[#6B7280]">错误信息: {error instanceof Error ? error.message : String(error)}</p>
				</div>
			</div>
		);
	}
};
