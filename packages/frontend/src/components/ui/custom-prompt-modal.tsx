import React, {useEffect, useState} from 'react';
import {Button} from './button';
import {ViteReactSettings} from '../../types';
import {AI_STYLES, AIStyle} from './ai-analysis-split-button';
import {Code, Copy, FileText, Sparkles, Wand2, X} from 'lucide-react';

interface CustomPromptModalProps {
	isOpen: boolean;
	onClose: () => void;
	settings: ViteReactSettings;
	onSettingsChange: (settings: Partial<ViteReactSettings>) => void;
	onSaveSettings: () => void;
	onAnalyze: (style: AIStyle) => void;
}

export const CustomPromptModal: React.FC<CustomPromptModalProps> = ({
																		isOpen,
																		onClose,
																		settings,
																		onSettingsChange,
																		onSaveSettings,
																		onAnalyze
																	}) => {
	const [customPrompt, setCustomPrompt] = useState<string>(settings.aiPromptTemplate || '');
	const [selectedTemplate, setSelectedTemplate] = useState<string>('');
	const [activeTab, setActiveTab] = useState<'templates' | 'editor' | 'variables'>(() => {
		try {
			const saved = localStorage.getItem('zepress-custom-prompt-active-tab') as 'templates' | 'editor' | 'variables';
			return saved || 'templates';
		} catch {
			return 'templates';
		}
	});

	useEffect(() => {
		if (isOpen) {
			setCustomPrompt(settings.aiPromptTemplate || '');
		}
	}, [isOpen, settings.aiPromptTemplate]);

	if (!isOpen) return null;

	const handleSave = () => {
		onSettingsChange({aiPromptTemplate: customPrompt.trim()});
		onSaveSettings();
		onClose();
	};

	const handleUseTemplate = (template: string) => {
		setCustomPrompt(template);
		setActiveTab('editor');
		// 持久化保存选中的tab
		try {
			localStorage.setItem('zepress-custom-prompt-active-tab', 'editor');
		} catch (error) {
			console.warn('Failed to save custom prompt tab to localStorage:', error);
		}
	};

	const handlePreviewAndAnalyze = () => {
		const customStyle: AIStyle = {
			id: 'custom',
			name: '自定义分析',
			description: '使用用户自定义的prompt模板',
			icon: '⚙️',
			prompt: customPrompt
		};

		onSettingsChange({aiPromptTemplate: customPrompt.trim()});
		onSaveSettings();
		onAnalyze(customStyle);
		onClose();
	};

	const copyToClipboard = async (text: string) => {
		try {
			await navigator.clipboard.writeText(text);
		} catch (err) {
			console.error('Failed to copy:', err);
		}
	};

	const getDefaultPromptTemplate = () => {
		return AI_STYLES[0].prompt;
	};

	const variables = [
		{name: 'content', description: '文章正文内容（已移除frontmatter）', example: '{{content}}'},
		{name: 'filename', description: '当前文件名（不含扩展名）', example: '{{filename}}'},
		{name: 'personalInfo.name', description: '个人信息中的姓名', example: '{{personalInfo.name}}'},
		{name: 'personalInfo.bio', description: '个人信息中的简介', example: '{{personalInfo.bio}}'},
		{name: 'personalInfo.email', description: '个人信息中的邮箱', example: '{{personalInfo.email}}'},
		{name: 'personalInfo.website', description: '个人信息中的网站', example: '{{personalInfo.website}}'},
		{name: 'frontmatter', description: '当前文档的frontmatter对象', example: '{{frontmatter}}'},
		{name: 'today', description: '当前日期（YYYY-MM-DD格式）', example: '{{today}}'},
	];

	const handlebarsHelpers = [
		{name: '#if', description: '条件判断', example: '{{#if variable}}...{{/if}}'},
		{name: '#each', description: '循环遍历', example: '{{#each array}}...{{/each}}'},
		{name: '#unless', description: '反向条件', example: '{{#unless variable}}...{{/unless}}'},
		{name: '@key', description: '循环中的键名', example: '{{#each object}}{{@key}}: {{this}}{{/each}}'},
		{name: '@index', description: '循环中的索引', example: '{{#each array}}{{@index}}: {{this}}{{/each}}'},
	];

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			{/* 背景遮罩 */}
			<div
				className="absolute inset-0 bg-black/60 backdrop-blur-sm"
				onClick={onClose}
			/>

			{/* 模态框内容 */}
			<div className="relative z-10 w-full max-w-6xl mx-4 max-h-[95vh] overflow-hidden">
				<div className="bg-white rounded-2xl shadow-2xl">
					{/* 头部 */}
					<div className="relative bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-6 text-white">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3">
								<div className="p-2 bg-white/20 rounded-lg">
									<Wand2 className="h-6 w-6"/>
								</div>
								<div>
									<h2 className="text-2xl font-bold">AI 分析模板编辑器</h2>
									<p className="text-blue-100 mt-1">自定义您的智能分析提示词</p>
								</div>
							</div>
							<button
								onClick={onClose}
								className="p-2 hover:bg-white/20 rounded-lg transition-colors"
							>
								<X className="h-6 w-6"/>
							</button>
						</div>

						{/* 标签页导航 */}
						<div className="flex gap-1 mt-6">
							{[
								{key: 'templates', label: '模板库', icon: FileText},
								{key: 'editor', label: '编辑器', icon: Code},
								{key: 'variables', label: '变量参考', icon: Sparkles}
							].map(({key, label, icon: Icon}) => (
								<button
									key={key}
									onClick={() => {
										const tabKey = key as 'templates' | 'editor' | 'variables';
										setActiveTab(tabKey);
										// 持久化保存选中的tab
										try {
											localStorage.setItem('zepress-custom-prompt-active-tab', tabKey);
										} catch (error) {
											console.warn('Failed to save custom prompt tab to localStorage:', error);
										}
									}}
									className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
										activeTab === key
											? 'bg-white text-blue-600 shadow-lg'
											: 'text-blue-100 hover:bg-white/20'
									}`}
								>
									<Icon className="h-4 w-4"/>
									{label}
								</button>
							))}
						</div>
					</div>

					{/* 内容区域 */}
					<div className="p-6 max-h-[60vh] overflow-y-auto">
						{/* 模板库标签页 */}
						{activeTab === 'templates' && (
							<div className="space-y-6">
								<div className="text-center">
									<h3 className="text-lg font-semibold text-gray-900 mb-2">选择预设模板</h3>
									<p className="text-gray-600">选择一个预设模板作为起点，然后在编辑器中进行自定义</p>
								</div>

								<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
									{AI_STYLES.map((style) => (
										<div
											key={style.id}
											className="group border-2 border-gray-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-lg transition-all cursor-pointer"
											onClick={() => handleUseTemplate(style.prompt)}
										>
											<div className="flex items-center gap-3 mb-3">
												<div
													className="p-2 bg-gray-100 group-hover:bg-blue-100 rounded-lg transition-colors">
													<span className="text-xl">{style.icon}</span>
												</div>
												<div>
													<h4 className="font-semibold text-gray-900">{style.name}</h4>
													<p className="text-sm text-gray-500">{style.description}</p>
												</div>
											</div>
											<div className="flex items-center justify-between">
												<span className="text-xs text-gray-400">点击使用此模板</span>
												<button
													onClick={(e) => {
														e.stopPropagation();
														copyToClipboard(style.prompt);
													}}
													className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
													title="复制模板"
												>
													<Copy className="h-4 w-4"/>
												</button>
											</div>
										</div>
									))}
								</div>
							</div>
						)}

						{/* 编辑器标签页 */}
						{activeTab === 'editor' && (
							<div className="space-y-6">
								<div className="flex items-center justify-between">
									<div>
										<h3 className="text-lg font-semibold text-gray-900">提示词编辑器</h3>
										<p className="text-gray-600">使用 Handlebars 语法编写您的自定义分析模板</p>
									</div>
									<div className="flex items-center gap-2">
										<Button
											onClick={() => handleUseTemplate(getDefaultPromptTemplate())}
											size="sm"
											variant="outline"
											className="text-gray-600"
										>
											恢复默认
										</Button>
										<Button
											onClick={() => copyToClipboard(customPrompt)}
											size="sm"
											variant="outline"
											className="text-gray-600"
										>
											<Copy className="h-4 w-4 mr-1"/>
											复制
										</Button>
									</div>
								</div>

								<div className="relative">
									<textarea
										value={customPrompt}
										onChange={(e) => setCustomPrompt(e.target.value)}
										placeholder="在此输入您的自定义 AI 提示词模板..."
										className="w-full h-80 px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:ring-0 font-mono text-sm resize-none transition-colors"
									/>
									<div className="absolute bottom-3 right-3 text-xs text-gray-400">
										{customPrompt.length} 字符
									</div>
								</div>

								<div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
									<div className="flex items-start gap-3">
										<div className="p-1 bg-amber-100 rounded-lg">
											<Sparkles className="h-5 w-5 text-amber-600"/>
										</div>
										<div>
											<h4 className="font-medium text-amber-900 mb-2">提示词编写建议</h4>
											<ul className="text-sm text-amber-800 space-y-1">
												<li>• 使用清晰明确的指令描述您想要的分析结果</li>
												<li>• 指定返回格式（建议使用 JSON 格式）</li>
												<li>• 利用模板变量注入上下文信息</li>
												<li>• 添加具体的输出要求和限制条件</li>
											</ul>
										</div>
									</div>
								</div>
							</div>
						)}

						{/* 变量参考标签页 */}
						{activeTab === 'variables' && (
							<div className="space-y-6">
								<div className="text-center">
									<h3 className="text-lg font-semibold text-gray-900 mb-2">模板变量参考</h3>
									<p className="text-gray-600">在您的提示词中使用这些变量来动态注入内容</p>
								</div>

								<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
									{/* 可用变量 */}
									<div className="space-y-4">
										<h4 className="font-semibold text-gray-900 flex items-center gap-2">
											<span className="p-1 bg-blue-100 rounded">📋</span>
											可用变量
										</h4>
										<div className="space-y-3">
											{variables.map((variable) => (
												<div key={variable.name} className="bg-gray-50 rounded-lg p-3">
													<div className="flex items-center justify-between mb-1">
														<code
															className="text-sm font-mono text-blue-600 bg-blue-50 px-2 py-1 rounded">
															{variable.example}
														</code>
														<button
															onClick={() => copyToClipboard(variable.example)}
															className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
														>
															<Copy className="h-3 w-3"/>
														</button>
													</div>
													<p className="text-sm text-gray-600">{variable.description}</p>
												</div>
											))}
										</div>
									</div>

									{/* Handlebars 语法 */}
									<div className="space-y-4">
										<h4 className="font-semibold text-gray-900 flex items-center gap-2">
											<span className="p-1 bg-purple-100 rounded">🔧</span>
											Handlebars 语法
										</h4>
										<div className="space-y-3">
											{handlebarsHelpers.map((helper) => (
												<div key={helper.name} className="bg-gray-50 rounded-lg p-3">
													<div className="flex items-center justify-between mb-1">
														<code
															className="text-sm font-mono text-purple-600 bg-purple-50 px-2 py-1 rounded">
															{helper.example}
														</code>
														<button
															onClick={() => copyToClipboard(helper.example)}
															className="p-1 text-gray-400 hover:text-purple-600 transition-colors"
														>
															<Copy className="h-3 w-3"/>
														</button>
													</div>
													<p className="text-sm text-gray-600">{helper.description}</p>
												</div>
											))}
										</div>
									</div>
								</div>

								<div
									className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-xl p-4">
									<h4 className="font-medium text-blue-900 mb-2">使用示例</h4>
									<div className="bg-white rounded-lg p-3 font-mono text-sm">
										<code className="text-gray-700">
											{`{{#if personalInfo.name}}
作者：{{personalInfo.name}}
{{/if}}

{{#each frontmatter}}
- {{@key}}: {{this}}
{{/each}}`}
										</code>
									</div>
								</div>
							</div>
						)}
					</div>

					{/* 底部操作栏 */}
					<div className="border-t bg-gray-50 px-6 py-4">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2 text-sm text-gray-500">
								<span className="w-2 h-2 bg-green-500 rounded-full"></span>
								模板已同步保存
							</div>
							<div className="flex items-center gap-3">
								<Button
									onClick={() => setCustomPrompt('')}
									variant="outline"
									className="text-red-600 border-red-300 hover:bg-red-50"
								>
									清空模板
								</Button>
								<Button
									onClick={onClose}
									variant="outline"
								>
									关闭
								</Button>
								<Button
									onClick={handleSave}
									className="bg-gray-600 hover:bg-gray-700 text-white"
								>
									保存设置
								</Button>
								<Button
									onClick={handlePreviewAndAnalyze}
									disabled={!customPrompt.trim()}
									className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-lg"
								>
									<Wand2 className="h-4 w-4 mr-2"/>
									保存并分析
								</Button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};
