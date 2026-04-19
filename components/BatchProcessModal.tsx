import React, { useState, useRef } from 'react';
import { X, Upload, FileText, ImageIcon, Play, Pause, Square, CheckCircle, AlertCircle, Loader2, Plus, Edit3, Trash2, Eraser } from 'lucide-react';
import { parsePromptFile } from '../src/utils/fileParser';
import { BatchProcessor, ProgressInfo, BatchTask } from '../src/utils/batchProcessor';
import { generateImage, editImage } from '../services/geminiService';
import { useSelectionStore } from '../src/store/selectionStore';
import GlassModal from './GlassModal';

interface BatchProcessModalProps {
    isOpen: boolean;
    onClose: () => void;
    apiKey: string | null;
    onInitGenerations: (count: number, prompt: string, aspectRatio?: string, baseNode?: any, type?: 'IMAGE' | 'VIDEO') => string[];
    onUpdateGeneration: (id: string, src: string | null, error?: string) => void;
}

const BatchProcessModal: React.FC<BatchProcessModalProps> = ({ isOpen, onClose, apiKey, onInitGenerations, onUpdateGeneration }) => {
    const [activeTab, setActiveTab] = useState<'T2I' | 'I2I'>('T2I');
    const [prompts, setPrompts] = useState<{ text: string, status: 'idle' | 'loading' | 'success' | 'failed', error?: string }[]>([]);
    const [refImages, setRefImages] = useState<string[]>([]);
    const [unifiedPrompt, setUnifiedPrompt] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState<ProgressInfo | null>(null);
    const [aspectRatio, setAspectRatio] = useState('1:1');
    const [imageSize, setImageSize] = useState('1k');
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editingText, setEditingText] = useState('');

    const processorRef = useRef<BatchProcessor | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const imgInputRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const extractedPrompts = await parsePromptFile(file);
            setPrompts(extractedPrompts.map(p => ({ text: p, status: 'idle' })));
        } catch (err) {
            alert((err as Error).message);
        }
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            Array.from(e.target.files).forEach(file => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    if (ev.target?.result) {
                        setRefImages(prev => [...prev, ev.target!.result as string]);
                    }
                };
                reader.readAsDataURL(file);
            });
        }
    };

    const startBatchProcess = async () => {
        if (!apiKey) {
            alert('请先设置 API Key');
            return;
        }

        const tasks: (Omit<BatchTask, 'status' | 'id'> & { id?: string })[] = [];

        if (activeTab === 'T2I') {
            if (prompts.length === 0) return;
            // 只生成未生成或失败的图片
            prompts.forEach((p, idx) => {
                if (p.status !== 'success') {
                    tasks.push({ type: 'T2I', prompt: p.text, id: `t2i-${idx}` });
                }
            });
        } else {
            if (refImages.length === 0 || !unifiedPrompt.trim()) return;
            refImages.forEach((img, idx) => tasks.push({ type: 'I2I', prompt: unifiedPrompt, referenceImage: img, id: `i2i-${idx}` }));
        }

        setIsProcessing(true);
        const processor = new BatchProcessor(3, (info) => {
            setProgress(info);
        });
        processorRef.current = processor;
        processor.addTasks(tasks);

        await processor.start(async (task) => {
            const taskIndex = parseInt(task.id!.split('-')[1]);

            // 在画布上占位
            const placeholderIds = onInitGenerations(1, task.prompt, aspectRatio, task.referenceImage ? { type: 'IMAGE', src: task.referenceImage, width: 512, height: 512 } : undefined);
            const pid = placeholderIds[0];

            if (task.type === 'T2I') {
                setPrompts(prev => {
                    const next = [...prev];
                    next[taskIndex] = { ...next[taskIndex], status: 'loading' };
                    return next;
                });
            }

            try {
                let srcs: string[] = [];
                if (task.type === 'T2I') {
                    srcs = await generateImage(apiKey!, task.prompt, aspectRatio, imageSize, 1);
                } else {
                    srcs = await editImage(apiKey!, task.referenceImage!, task.prompt, aspectRatio, imageSize, 1);
                }

                if (srcs.length > 0) {
                    onUpdateGeneration(pid, srcs[0]);
                    if (task.type === 'T2I') {
                        setPrompts(prev => {
                            const next = [...prev];
                            next[taskIndex] = { ...next[taskIndex], status: 'success' };
                            return next;
                        });
                    }
                    return srcs[0];
                } else {
                    throw new Error('未返回图片');
                }
            } catch (err) {
                const errMsg = (err as Error).message;
                onUpdateGeneration(pid, null, errMsg);
                if (task.type === 'T2I') {
                    setPrompts(prev => {
                        const next = [...prev];
                        next[taskIndex] = { ...next[taskIndex], status: 'failed', error: errMsg };
                        return next;
                    });
                }
                throw err;
            }
        });

        setIsProcessing(false);
    };

    const stopProcess = () => {
        processorRef.current?.stop();
        setIsProcessing(false);
    };

    const handleEditPrompt = (index: number) => {
        setEditingIndex(index);
        setEditingText(prompts[index].text);
    };

    const saveEditPrompt = () => {
        if (editingIndex !== null) {
            const newPrompts = [...prompts];
            newPrompts[editingIndex] = { ...newPrompts[editingIndex], text: editingText, status: 'idle' };
            setPrompts(newPrompts);
            setEditingIndex(null);
        }
    };

    const deletePrompt = (index: number) => {
        setPrompts(prev => prev.filter((_, i) => i !== index));
        if (editingIndex === index) setEditingIndex(null);
    };

    const retryPrompt = (index: number) => {
        if (isProcessing) return;
        const task = { type: 'T2I' as const, prompt: prompts[index].text, id: `t2i-${index}` };

        setIsProcessing(true);
        const processor = new BatchProcessor(1, (info) => setProgress(info));
        processorRef.current = processor;
        processor.addTasks([task]);

        processor.start(async (t) => {
            const placeholderIds = onInitGenerations(1, t.prompt, aspectRatio);
            const pid = placeholderIds[0];
            setPrompts(prev => {
                const next = [...prev];
                next[index] = { ...next[index], status: 'loading' };
                return next;
            });
            try {
                const srcs = await generateImage(apiKey!, t.prompt, aspectRatio, imageSize, 1);
                if (srcs.length > 0) {
                    onUpdateGeneration(pid, srcs[0]);
                    setPrompts(prev => {
                        const next = [...prev];
                        next[index] = { ...next[index], status: 'success' };
                        return next;
                    });
                } else throw new Error('未返回图片');
            } catch (err) {
                const msg = (err as Error).message;
                onUpdateGeneration(pid, null, msg);
                setPrompts(prev => {
                    const next = [...prev];
                    next[index] = { ...next[index], status: 'failed', error: msg };
                    return next;
                });
            }
        }).finally(() => setIsProcessing(false));
    };

    const clearPrompts = () => {
        if (window.confirm('确定要清空所有已解析的提示词吗？')) {
            setPrompts([]);
            setEditingIndex(null);
        }
    };

    return (
        <GlassModal
            isOpen={isOpen}
            onClose={onClose}
            title="批量生成中心"
            width="max-w-5xl"
            className="h-[85vh]"
            contentClassName="overflow-hidden flex flex-col"
        >
            <div className="flex flex-col h-full bg-transparent">
                {/* Tabs */}
                <div className="flex border-b border-white/5 bg-black/20 shrink-0">
                    <button
                        onClick={() => !isProcessing && setActiveTab('T2I')}
                        className={`flex-1 py-3 text-sm font-medium transition-colors relative ${activeTab === 'T2I' ? 'text-blue-400 bg-blue-500/5' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}`}
                    >
                        批量文字生成图片 (支持 Excel/Word)
                        {activeTab === 'T2I' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />}
                    </button>
                    <button
                        onClick={() => !isProcessing && setActiveTab('I2I')}
                        className={`flex-1 py-3 text-sm font-medium transition-colors relative ${activeTab === 'I2I' ? 'text-blue-400 bg-blue-500/5' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}`}
                    >
                        批量图片生成图片 (多图上传)
                        {activeTab === 'I2I' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />}
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 scrollbar-none custom-scrollbar flex flex-col gap-6">
                    {activeTab === 'T2I' ? (
                        <div className="space-y-4">
                            <div
                                onClick={() => !isProcessing && fileInputRef.current?.click()}
                                className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-3 transition-all cursor-pointer ${prompts.length > 0 ? 'border-blue-500/30 bg-blue-500/5' : 'border-white/10 hover:border-white/20 bg-white/5'}`}
                            >
                                <FileText size={40} className={prompts.length > 0 ? 'text-blue-400' : 'text-gray-600'} />
                                <div className="text-center">
                                    <p className="text-sm font-medium text-gray-200">点击上传提示词文件</p>
                                    <p className="text-xs text-gray-500 mt-1">支持 .xlsx, .docx, .txt</p>
                                </div>
                                {prompts.length > 0 && (
                                    <div className="mt-2 px-3 py-1 bg-blue-500/20 text-blue-300 text-xs rounded-full border border-blue-500/20">
                                        已解析 {prompts.length} 条提示词
                                    </div>
                                )}
                            </div>
                            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.docx,.txt" className="hidden" onChange={handleFileUpload} />

                            {prompts.length > 0 && (
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-gray-400 font-medium">已解析提示词列表 ({prompts.length})</span>
                                        <button
                                            onClick={clearPrompts}
                                            className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1 px-2 py-1 rounded hover:bg-red-500/10 transition-colors"
                                        >
                                            <Eraser size={12} /> 一键清空
                                        </button>
                                    </div>
                                    <div className="max-h-[300px] overflow-y-auto border border-white/5 rounded-xl bg-black/20 custom-scrollbar flex flex-col divide-y divide-white/5">
                                        {prompts.map((p, i) => (
                                            <div key={i} className="group p-3 flex items-start gap-3 hover:bg-white/5 transition-colors">
                                                <span className="text-[10px] text-gray-600 mt-1 font-mono shrink-0">{String(i + 1).padStart(2, '0')}</span>
                                                <div className="flex-1 min-w-0">
                                                    {editingIndex === i ? (
                                                        <div className="flex flex-col gap-2">
                                                            <textarea
                                                                autoFocus
                                                                value={editingText}
                                                                onChange={(e) => setEditingText(e.target.value)}
                                                                className="w-full bg-black/40 border border-blue-500/50 rounded p-2 text-xs focus:outline-none focus:border-blue-500 min-h-[60px] resize-none text-gray-200"
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveEditPrompt();
                                                                    if (e.key === 'Escape') setEditingIndex(null);
                                                                }}
                                                            />
                                                            <div className="flex justify-end gap-2">
                                                                <button onClick={() => setEditingIndex(null)} className="text-[10px] px-2 py-1 text-gray-500 hover:text-gray-300">取消</button>
                                                                <button onClick={saveEditPrompt} className="text-[10px] px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors">保存</button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-col gap-1">
                                                            <p className="text-xs text-gray-300 leading-relaxed break-words">{p.text}</p>
                                                            {p.status === 'failed' && (
                                                                <p className="text-[10px] text-red-400 flex items-center gap-1">
                                                                    <AlertCircle size={10} /> 失败: {p.error}
                                                                </p>
                                                            )}
                                                            {p.status === 'success' && (
                                                                <p className="text-[10px] text-green-400 flex items-center gap-1">
                                                                    <CheckCircle size={10} /> 已生成
                                                                </p>
                                                            )}
                                                            {p.status === 'loading' && (
                                                                <p className="text-[10px] text-blue-400 flex items-center gap-1">
                                                                    <Loader2 size={10} className="animate-spin" /> 正在生成...
                                                                </p>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                                {!isProcessing && editingIndex !== i && (
                                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        {p.status === 'failed' && (
                                                            <button
                                                                onClick={() => retryPrompt(i)}
                                                                className="p-1.5 text-orange-400 hover:bg-orange-500/10 rounded transition-colors"
                                                                title="重试"
                                                            >
                                                                <Play size={14} />
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => handleEditPrompt(i)}
                                                            className="p-1.5 text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 rounded transition-colors"
                                                            title="编辑"
                                                        >
                                                            <Edit3 size={14} />
                                                        </button>
                                                        <button
                                                            onClick={() => deletePrompt(i)}
                                                            className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                                                            title="删除"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-[10px] text-gray-600 italic">小提示：Ctrl + Enter 可快速保存编辑内容</p>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs text-gray-400 mb-2">批量上传参考图 ({refImages.length})</label>
                                <div className="flex flex-wrap gap-2 p-3 border border-white/10 rounded-xl bg-black/20 max-h-48 overflow-y-auto custom-scrollbar">
                                    {refImages.map((src, idx) => (
                                        <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden border border-white/10 group">
                                            <img src={src} className="w-full h-full object-cover" />
                                            <button
                                                onClick={() => setRefImages(prev => prev.filter((_, i) => i !== idx))}
                                                className="absolute top-1 right-1 bg-black/60 hover:bg-red-500 text-white p-1 rounded-md opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm"
                                            >
                                                <X size={12} />
                                            </button>
                                        </div>
                                    ))}
                                    <button
                                        onClick={() => imgInputRef.current?.click()}
                                        className="w-20 h-20 rounded-lg border border-dashed border-white/10 flex flex-col items-center justify-center text-gray-500 hover:text-gray-300 hover:border-white/30 transition-all bg-white/5 hover:bg-white/10"
                                    >
                                        <Plus size={20} />
                                        <span className="text-[10px] mt-1">添加</span>
                                    </button>
                                </div>
                                <input ref={imgInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-2">统一提示词</label>
                                <textarea
                                    value={unifiedPrompt}
                                    onChange={(e) => setUnifiedPrompt(e.target.value)}
                                    placeholder="输入要应用到所有参考图的提示词..."
                                    className="w-full h-24 bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-gray-200 placeholder-gray-600 focus:border-blue-500/50 focus:bg-white/10 focus:outline-none resize-none transition-all"
                                />
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">画幅比例</label>
                            <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-gray-200 focus:border-white/20 focus:outline-none appearance-none cursor-pointer hover:bg-white/10 transition-colors">
                                <option value="1:1" className="bg-gray-900">1:1 (正方形)</option>
                                <option value="16:9" className="bg-gray-900">16:9 (横屏)</option>
                                <option value="9:16" className="bg-gray-900">9:16 (竖屏)</option>
                                <option value="4:3" className="bg-gray-900">4:3 (标准)</option>
                                <option value="3:4" className="bg-gray-900">3:4 (纵向)</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">图片尺寸</label>
                            <select value={imageSize} onChange={(e) => setImageSize(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-gray-200 focus:border-white/20 focus:outline-none appearance-none cursor-pointer hover:bg-white/10 transition-colors">
                                <option value="1k" className="bg-gray-900">1K (标准)</option>
                                <option value="2k" className="bg-gray-900">2K (高清)</option>
                                <option value="4k" className="bg-gray-900">4K (超清)</option>
                            </select>
                        </div>
                    </div>

                    {progress && (
                        <div className="space-y-3 py-4 border-t border-white/5">
                            <div className="flex items-center justify-between text-xs font-medium mb-1">
                                <span className="text-gray-400">总体进度: {progress?.completed} / {progress?.total}</span>
                                <span className="text-blue-400 font-bold">{progress?.total ? Math.round((progress.completed / progress.total) * 100) : 0}%</span>
                            </div>
                            <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden border border-white/5">
                                <div
                                    className="h-full bg-linear-to-r from-blue-600 to-indigo-500 shadow-[0_0_10px_rgba(59,130,246,0.3)] transition-all duration-300"
                                    style={{ width: `${progress?.total ? (progress.completed / progress.total) * 100 : 0}%` }}
                                />
                            </div>
                            <div className="flex flex-wrap gap-4 text-[10px]">
                                <span className="flex items-center gap-1 text-green-400 bg-green-500/10 px-2 py-0.5 rounded border border-green-500/20"><CheckCircle size={10} /> 成功 {progress?.success}</span>
                                <span className="flex items-center gap-1 text-red-400 bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20"><AlertCircle size={10} /> 失败 {progress?.failed}</span>
                                {progress?.currentTask && (
                                    <span className="flex items-center gap-1 text-gray-500 italic truncate max-w-[200px]">
                                        正在处理: {progress.currentTask.prompt.substring(0, 20)}...
                                    </span>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-white/5 bg-black/20 shrink-0 flex gap-3">
                    {isProcessing ? (
                        <button
                            onClick={stopProcess}
                            className="flex-1 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 font-bold rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95"
                        >
                            <Square size={16} fill="currentColor" />
                            停止生成
                        </button>
                    ) : (
                        <button
                            onClick={startBatchProcess}
                            disabled={(activeTab === 'T2I' && prompts.length === 0) || (activeTab === 'I2I' && (refImages.length === 0 || !unifiedPrompt.trim()))}
                            className="flex-1 py-3 bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-900/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:grayscale"
                        >
                            <Play size={16} fill="currentColor" />
                            一键开始批量生成
                        </button>
                    )}
                </div>
            </div>
        </GlassModal>
    );
};

export default BatchProcessModal;
