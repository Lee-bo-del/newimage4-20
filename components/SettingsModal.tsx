import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { X, Key, CreditCard, ShoppingCart, Loader2, History, Settings, RotateCcw, Trash2, Eye, EyeOff, Download, ImagePlus, Maximize2, DownloadCloud, Info, Film, AlertCircle, Megaphone, Save, Search, Pin, PinOff, ChevronLeft, ChevronRight, Upload, Image as ImageIcon } from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { checkBalance } from '../services/geminiService';
import { useHistoryStore } from '../src/store/historyStore';
import { useSelectionStore } from '../src/store/selectionStore';
import wechatQR from '../src/assets/wechat_qr.png';
import GlassModal from './GlassModal';
import CoinIcon from './CoinIcon';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReusePrompt?: (prompt: string, type: 'image' | 'video') => void;
  onViewImage?: (src: string) => void;
  onDownloadImage?: (src: string, prompt?: string, id?: string) => void;
  onUseAsReference?: (src: string) => void;
  initialTab?: 'settings' | 'history';
}

interface AnnouncementItem {
  id: string;
  title: string;
  content: string;
  active: boolean;
  date: string;
  pinned?: boolean;
  images?: string[];
}

const ANNOUNCEMENT_ADMIN_KEY = 'sk-K9OJf52OughwT8vizrDKJpvMebzutpbKVXxxhYe8EZFF0nm7';


const ResolvedHistoryItem = ({ 
  log, 
  historyMediaType, 
  onViewImage, 
  handleReusePrompt, 
  onUseAsReference,
  onDownloadImage,
  isMobile = false,
  blockActions = false
}: { 
  log: any; 
  historyMediaType: 'image' | 'video';
  onViewImage?: (src: string) => void;
  handleReusePrompt: (prompt: string) => void;
  onUseAsReference?: (src: string) => void;
  onDownloadImage?: (src: string, prompt?: string, id?: string) => void;
  isMobile?: boolean;
  blockActions?: boolean;
}) => {
  const [resolvedUrl, setResolvedUrl] = useState<string>(log.imageUrl);
  const [hasError, setHasError] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchMovedRef = useRef(false);
  const extractRawFromProxy = (url: string): string | null => {
    if (!url?.startsWith('/api/proxy/image?url=')) return null;
    try {
      const u = new URL(url, window.location.origin);
      return u.searchParams.get('url');
    } catch {
      return null;
    }
  };
  const handleMediaLoadError = () => {
    const raw = extractRawFromProxy(resolvedUrl);
    if (raw) {
      setResolvedUrl(raw);
      return;
    }
    setHasError(true);
  };

  useEffect(() => {
    let active = true;
    const resolveAsset = async () => {
      if (log.assetId && (log.imageUrl.startsWith('blob:') || hasError)) {
        try {
          const freshUrl = await import('../src/services/assetStorage').then(m => m.assetStorage.getAssetUrl(log.assetId!));
          if (freshUrl && active) {
            setResolvedUrl(freshUrl);
            setHasError(false);
          }
        } catch (e) {
          console.warn("Could not resolve asset blob for history item", log.assetId);
        }
      }
    };
    resolveAsset();
    return () => { active = false; };
  }, [log.assetId, log.imageUrl, hasError]);

  const actionBtnClass = isMobile
    ? "min-w-9 min-h-9 px-2 bg-white/10 active:bg-white/20 text-white rounded-lg transition-colors touch-manipulation active:scale-95"
    : "min-w-8 min-h-8 px-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors";
  if (!isMobile) {
    return (
      <div
        key={log.id}
        className="relative group rounded-xl overflow-hidden"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', resolvedUrl);
          e.dataTransfer.effectAllowed = 'copy';
        }}
      >
        {log.type === 'VIDEO' ? (
          <video
            src={resolvedUrl}
            className="w-full h-auto block"
            muted
            loop
            playsInline
            onMouseOver={e => e.currentTarget.play().catch(console.warn)}
            onMouseOut={e => e.currentTarget.pause()}
            onError={handleMediaLoadError}
          />
        ) : (
          <img
            src={resolvedUrl}
            alt={log.prompt}
            className="w-full h-auto block"
            loading="lazy"
            onError={handleMediaLoadError}
          />
        )}
        
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all duration-200 flex flex-col justify-end p-2 pointer-events-none">
          <div className="flex justify-center gap-2 mb-2">
            <button 
              onClick={() => onViewImage && onViewImage(resolvedUrl)}
              className="pointer-events-auto p-1.5 bg-white/20 hover:bg-blue-500 text-white rounded-lg backdrop-blur-sm transition-colors"
              title={historyMediaType === 'video' ? "播放" : "放大查看"}
            >
              {historyMediaType === 'video' ? <Film size={14} /> : <Maximize2 size={14} />}
            </button>
            <button 
              onClick={() => handleReusePrompt(log.prompt)}
              className="pointer-events-auto p-1.5 bg-white/20 hover:bg-blue-500 text-white rounded-lg backdrop-blur-sm transition-colors"
              title="再次生成"
            >
              <RotateCcw size={14} />
            </button>
            {historyMediaType === 'image' && (
              <button 
                onClick={() => onUseAsReference && onUseAsReference(resolvedUrl)}
                className="pointer-events-auto p-1.5 bg-white/20 hover:bg-purple-500 text-white rounded-lg backdrop-blur-sm transition-colors"
                title="用作参考图"
              >
                <ImagePlus size={14} />
              </button>
            )}
            <button 
              onClick={() => onDownloadImage && onDownloadImage(resolvedUrl, log.prompt, log.id)}
              className="pointer-events-auto p-1.5 bg-white/20 hover:bg-green-500 text-white rounded-lg backdrop-blur-sm transition-colors"
              title="下载"
            >
              <Download size={14} />
            </button>
          </div>
          <p className="text-[10px] text-gray-300 line-clamp-2 leading-tight opacity-80">{log.prompt}</p>
        </div>
      </div>
    );
  }
  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    touchStartRef.current = { x: t.clientX, y: t.clientY };
    touchMovedRef.current = false;
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = Math.abs(t.clientX - touchStartRef.current.x);
    const dy = Math.abs(t.clientY - touchStartRef.current.y);
    if (dx > 8 || dy > 8) {
      touchMovedRef.current = true;
    }
  };
  const runActionSafely = (action: () => void) => {
    if (blockActions) return;
    if (touchMovedRef.current) {
      touchMovedRef.current = false;
      return;
    }
    action();
  };

  return (
    <div
      key={log.id}
      className="h-full rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-2 flex gap-2 active:scale-[0.995] transition-transform"
      draggable
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', resolvedUrl);
        e.dataTransfer.effectAllowed = 'copy';
      }}
    >
      <button
        type="button"
        className={`relative shrink-0 ${isMobile ? 'w-20' : 'w-24'} h-full rounded-lg overflow-hidden border border-white/10 bg-black/30 ${blockActions ? 'pointer-events-none opacity-70' : ''}`}
        onClick={() => runActionSafely(() => onViewImage && onViewImage(resolvedUrl))}
        title={historyMediaType === 'video' ? "播放" : "放大查看"}
      >
        {log.type === 'VIDEO' ? (
          <video
            src={resolvedUrl}
            className="w-full h-full object-cover"
            muted
            loop
            playsInline
            onMouseOver={e => e.currentTarget.play().catch(console.warn)}
            onMouseOut={e => e.currentTarget.pause()}
            onError={handleMediaLoadError}
          />
        ) : (
          <img
            src={resolvedUrl}
            alt={log.prompt}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={handleMediaLoadError}
          />
        )}
        {historyMediaType === 'video' && (
          <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/60 border border-white/20 flex items-center justify-center">
            <Film size={10} />
          </div>
        )}
      </button>

      <div className="min-w-0 flex-1 flex flex-col justify-between">
        <p className={`text-gray-300 leading-snug line-clamp-2 ${isMobile ? 'text-xs' : 'text-[11px]'}`}>
          {log.prompt || "无提示词"}
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => runActionSafely(() => onViewImage && onViewImage(resolvedUrl))}
            className={`${actionBtnClass} ${blockActions ? 'pointer-events-none opacity-60' : ''}`}
            title={historyMediaType === 'video' ? "播放" : "查看"}
          >
            {historyMediaType === 'video' ? <Film size={13} /> : <Maximize2 size={13} />}
          </button>
          <button
            type="button"
            onClick={() => runActionSafely(() => handleReusePrompt(log.prompt))}
            className={`${actionBtnClass} ${blockActions ? 'pointer-events-none opacity-60' : ''}`}
            title="再次生成"
          >
            <RotateCcw size={13} />
          </button>
          {historyMediaType === 'image' && (
            <button
              type="button"
              onClick={() => runActionSafely(() => onUseAsReference && onUseAsReference(resolvedUrl))}
              className={`${actionBtnClass} ${blockActions ? 'pointer-events-none opacity-60' : ''}`}
              title="用作参考图"
            >
              <ImagePlus size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={() => runActionSafely(() => onDownloadImage && onDownloadImage(resolvedUrl, log.prompt, log.id))}
            className={`${actionBtnClass} ${blockActions ? 'pointer-events-none opacity-60' : ''}`}
            title="下载"
          >
            <Download size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};
const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onReusePrompt,
  onViewImage,
  onDownloadImage,
  onUseAsReference,
  initialTab = 'settings'
}) => {
  const { apiKey, setApiKey, autoDownloadOnSuccess, setAutoDownloadOnSuccess } = useSelectionStore();
  const [activeTab, setActiveTab] = useState<'settings' | 'history'>(initialTab);
  const [showApiKey, setShowApiKey] = useState(false);
  const [isCheckingBal, setIsCheckingBal] = useState(false);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [balanceData, setBalanceData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const { logs = [], clearLogs } = useHistoryStore();
  const safeLogs = Array.isArray(logs) ? logs : [];

  // Announcement State
  const [announcementForm, setAnnouncementForm] = useState({ title: '', content: '', active: true, pinned: false });
  const [isSavingAnnouncement, setIsSavingAnnouncement] = useState(false);
  const [isAnnouncementExpanded, setIsAnnouncementExpanded] = useState(false);
  const [announcementItems, setAnnouncementItems] = useState<AnnouncementItem[]>([]);
  const [isLoadingAnnouncements, setIsLoadingAnnouncements] = useState(false);
  const [deletingAnnouncementId, setDeletingAnnouncementId] = useState<string | null>(null);
  const [pinningAnnouncementId, setPinningAnnouncementId] = useState<string | null>(null);
  const [announcementSearchInput, setAnnouncementSearchInput] = useState('');
  const [announcementSearchKeyword, setAnnouncementSearchKeyword] = useState('');
  const [announcementPage, setAnnouncementPage] = useState(1);
  const [announcementPageSize] = useState(6);
  const [announcementTotal, setAnnouncementTotal] = useState(0);
  const [announcementTotalPages, setAnnouncementTotalPages] = useState(1);
  const [announcementImageDataUrls, setAnnouncementImageDataUrls] = useState<string[]>([]);
  const announcementImageInputRef = useRef<HTMLInputElement | null>(null);
  const isAnnouncementAdmin = apiKey.trim() === ANNOUNCEMENT_ADMIN_KEY;

  const fetchAnnouncements = useCallback(async ({
    all = false,
    page = 1,
    search = ''
  }: { all?: boolean; page?: number; search?: string } = {}) => {
    try {
      setIsLoadingAnnouncements(true);
      const headers: Record<string, string> = {};
      if (all) {
        headers['Authorization'] = apiKey || '';
      }
      const qs = new URLSearchParams();
      if (all) qs.set('all', '1');
      qs.set('page', String(page));
      qs.set('pageSize', String(announcementPageSize));
      if (search.trim()) qs.set('search', search.trim());
      const res = await fetch(`/api/announcements?${qs.toString()}`, { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || '加载公告失败');
      }
      const items = Array.isArray(data?.items) ? data.items : [];
      setAnnouncementItems(items);
      setAnnouncementTotal(Number(data?.total || 0));
      setAnnouncementTotalPages(Math.max(1, Number(data?.totalPages || 1)));
      setAnnouncementPage(Math.max(1, Number(data?.page || 1)));
    } catch (e: any) {
      setError(e?.message || '加载公告失败');
    } finally {
      setIsLoadingAnnouncements(false);
    }
  }, [announcementPageSize, apiKey]);

  useEffect(() => {
    if (isOpen && activeTab === 'settings') {
      void fetchAnnouncements({ all: false, page: 1, search: '' });
    }
  }, [activeTab, fetchAnnouncements, isOpen]);

  useEffect(() => {
    if (!isAnnouncementAdmin && isAnnouncementExpanded) {
      setIsAnnouncementExpanded(false);
    }
  }, [isAnnouncementAdmin, isAnnouncementExpanded]);

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.readAsDataURL(file);
    });

  const handleSelectAnnouncementImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const remain = Math.max(0, 9 - announcementImageDataUrls.length);
    const picked = files.slice(0, remain);
    if (!picked.length) {
      setError('公告图片最多 9 张');
      e.target.value = '';
      return;
    }
    try {
      const urls = await Promise.all(picked.map(readFileAsDataUrl));
      setAnnouncementImageDataUrls((prev) => [...prev, ...urls]);
      setError(null);
    } catch (err: any) {
      setError(err?.message || '读取公告图片失败');
    } finally {
      e.target.value = '';
    }
  };

  const uploadAnnouncementImages = async (): Promise<string[]> => {
    if (!announcementImageDataUrls.length) return [];
    const res = await fetch('/api/announcement/images', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey
      },
      body: JSON.stringify({ images: announcementImageDataUrls })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || '公告图片上传失败');
    }
    return Array.isArray(data?.urls) ? data.urls : [];
  };

  const handleSaveAnnouncement = async () => {
    if (!isAnnouncementAdmin) {
      setError("发布公告需要管理员 API Key");
      return;
    }
    if (!announcementForm.content.trim()) {
      setError("公告内容不能为空");
      return;
    }
    setIsSavingAnnouncement(true);
    try {
      const imageUrls = await uploadAnnouncementImages();
      const res = await fetch('/api/announcement', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': apiKey
        },
        body: JSON.stringify({ 
          title: announcementForm.title, 
          content: announcementForm.content, 
          active: announcementForm.active,
          pinned: announcementForm.pinned,
          images: imageUrls
        })
      });
      const data = await res.json();
      if (res.ok) {
        setError(null);
        setAnnouncementForm(prev => ({ ...prev, title: '', content: '', active: true, pinned: false }));
        setAnnouncementImageDataUrls([]);
        await fetchAnnouncements({
          all: true,
          page: 1,
          search: announcementSearchKeyword
        });
      } else {
        setError("发布失败: " + (data.error || "未知错误"));
      }
    } catch (e: any) {
      setError("发布失败: " + (e?.message || "网络错误"));
    } finally {
      setIsSavingAnnouncement(false);
    }
  };

  const handleDeleteAnnouncement = async (announcementId: string) => {
    if (!announcementId) return;
    if (!isAnnouncementAdmin) {
      setError("删除公告需要管理员 API Key");
      return;
    }

    try {
      setDeletingAnnouncementId(announcementId);
      const res = await fetch(`/api/announcement/${encodeURIComponent(announcementId)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': apiKey
        }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || '删除失败');
      }
      setError(null);
      await fetchAnnouncements({
        all: true,
        page: announcementPage,
        search: announcementSearchKeyword
      });
    } catch (e: any) {
      setError("删除失败: " + (e?.message || "未知错误"));
    } finally {
      setDeletingAnnouncementId(null);
    }
  };

  const handleTogglePinned = async (announcementId: string, pinned: boolean) => {
    if (!announcementId) return;
    if (!isAnnouncementAdmin) {
      setError("置顶公告需要管理员 API Key");
      return;
    }
    try {
      setPinningAnnouncementId(announcementId);
      const res = await fetch(`/api/announcement/${encodeURIComponent(announcementId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': apiKey
        },
        body: JSON.stringify({ pinned: !pinned })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || '置顶更新失败');
      }
      setError(null);
      await fetchAnnouncements({
        all: true,
        page: announcementPage,
        search: announcementSearchKeyword
      });
    } catch (e: any) {
      setError("置顶更新失败: " + (e?.message || "未知错误"));
    } finally {
      setPinningAnnouncementId(null);
    }
  };

  const [historyMediaType, setHistoryMediaType] = useState<'image' | 'video'>('image');
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640);
  const historyListRef = useRef<HTMLDivElement | null>(null);
  const historyScrollDebounceRef = useRef<number | null>(null);
  const [historyListHeight, setHistoryListHeight] = useState(420);
  const [historyScrollTop, setHistoryScrollTop] = useState(0);
  const [isHistoryScrolling, setIsHistoryScrolling] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const filteredLogs = useMemo(() => safeLogs.filter(log => {
      const isVideo = log.type === 'VIDEO';
      return historyMediaType === 'video' ? isVideo : !isVideo;
  }), [safeLogs, historyMediaType]);

  const refreshHistoryViewport = useCallback(() => {
    if (!historyListRef.current) return;
    const h = historyListRef.current.clientHeight;
    if (h > 0) setHistoryListHeight(h);
  }, []);

  useEffect(() => {
    if (isOpen && activeTab === 'history') {
      refreshHistoryViewport();
      setHistoryScrollTop(0);
      setIsHistoryScrolling(false);
    }
  }, [isOpen, activeTab, historyMediaType, filteredLogs.length, refreshHistoryViewport]);

  useEffect(() => {
    if (activeTab !== 'history') return;
    const onResize = () => refreshHistoryViewport();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [activeTab, refreshHistoryViewport]);
  useEffect(() => {
    return () => {
      if (historyScrollDebounceRef.current) {
        window.clearTimeout(historyScrollDebounceRef.current);
      }
    };
  }, []);

  const handleHistoryScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setHistoryScrollTop(e.currentTarget.scrollTop);
    setIsHistoryScrolling(true);
    if (historyScrollDebounceRef.current) {
      window.clearTimeout(historyScrollDebounceRef.current);
    }
    historyScrollDebounceRef.current = window.setTimeout(() => {
      setIsHistoryScrolling(false);
    }, 120);
  }, []);

  const ROW_HEIGHT = isMobile ? 124 : 128;
  const OVERSCAN = isMobile ? 4 : 6;
  const visibleRowCount = Math.max(1, Math.ceil(historyListHeight / ROW_HEIGHT));
  const startIndex = Math.max(0, Math.floor(historyScrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(filteredLogs.length, startIndex + visibleRowCount + OVERSCAN * 2);
  const virtualLogs = filteredLogs.slice(startIndex, endIndex);
  const topSpacerHeight = startIndex * ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(0, (filteredLogs.length - endIndex) * ROW_HEIGHT);

  // Sync activeTab with initialTab when opening
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);



  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setApiKey(e.target.value);
  };

  const handleCheckBalance = async () => {
    if (!apiKey) {
      setError("请先输入 API Key (密钥)");
      return;
    }
    setIsCheckingBal(true);
    setError(null);
    try {
      const data = await checkBalance(apiKey);
      if (data.success) {
        setBalanceData(data);
      } else {
        setError("查询失败：未知错误");
      }
    } catch (e: any) {
      if (e.message.includes('fetch') || e.message.includes('Network Error')) {
        setError("连接失败：请确保后端服务正在运行");
      } else {
        setError("查询失败：" + e.message);
      }
    } finally {
      setIsCheckingBal(false);
    }
  };

  const handleReusePrompt = (prompt: string) => {
    if (onReusePrompt) {
      onReusePrompt(prompt, historyMediaType);
      onClose();
    }
  };

  const handleClearHistory = () => {
    if (safeLogs.length === 0) return;
    if (!isConfirmingClear) {
      setIsConfirmingClear(true);
      // Auto-cancel after 3 seconds if not clicked again
      setTimeout(() => setIsConfirmingClear(false), 3000);
      return;
    }
    clearLogs();
    setIsConfirmingClear(false);
  };

  const handleDownloadAll = async () => {
    if (safeLogs.length === 0) return;
    setIsDownloadingAll(true);
    try {
      const zip = new JSZip();

      const downloadPromises = safeLogs.map(async (log, index) => {
        try {
          // fetch works for both URL and DataURL
          const response = await fetch(log.imageUrl);
          const blob = await response.blob();

          const cleanPrompt = (log.prompt || 'image').slice(0, 30).replace(/[^a-z0-9]/gi, '_').trim();
          const ext = blob.type.split('/')[1] || 'png';
          // reverse index so newest is highest number or just keep it simple
          const filename = `${String(safeLogs.length - index).padStart(3, '0')}_${cleanPrompt}.${ext}`;
          zip.file(filename, blob);
        } catch (e) {
          console.error("Batch download: failed to fetch image", log.imageUrl, e);
        }
      });

      await Promise.all(downloadPromises);
      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, `history_images_${new Date().toISOString().split('T')[0]}.zip`);
    } catch (err) {
      console.error("Batch download zip failed", err);
      alert("批量下载失败，请重试");
    } finally {
      setIsDownloadingAll(false);
    }
  };


  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onClose}
      title={activeTab === 'settings' ? '全局设置' : '历史记录'}
      width="max-w-2xl"
      className="h-[80vh] relative"
    >
      <div className="flex flex-col h-full bg-transparent">
        {/* Content */}
        <div className="flex-1 p-6">
          {activeTab === 'settings' ? (
            /* Settings Tab */
            <div className="space-y-6">
              <div>
                <label className="text-xs font-medium text-gray-400 mb-2 flex items-center gap-1.5 uppercase tracking-wider">
                  <Key size={12} /> API Key (密钥)
                </label>
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={handleApiKeyChange}
                      placeholder="输入 API Key"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-10 text-sm text-gray-200 placeholder-gray-600 focus:border-white/20 focus:bg-white/10 focus:outline-none transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors p-1"
                      title={showApiKey ? '隐藏密钥' : '显示密钥'}
                    >
                      {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <button 
                    onClick={onClose}
                    className="bg-purple-600/80 hover:bg-purple-500 text-white px-5 py-3 rounded-xl flex items-center gap-2 text-sm font-medium transition-all active:scale-95 shadow-lg shadow-purple-500/20"
                  >
                    <Save size={16} /> 保存
                  </button>
                </div>
              </div>

              {/* Balance & Purchase Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleCheckBalance}
                  disabled={isCheckingBal}
                  className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white text-sm py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95"
                >
                  {isCheckingBal ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />}
                  查询余额
                </button>
                <a
                  href="https://item.taobao.com/item.htm?id=975150888957"
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 bg-linear-to-r from-orange-500/20 to-red-500/20 hover:from-orange-500/30 hover:to-red-500/30 border border-orange-500/30 text-orange-200 hover:text-orange-100 text-sm py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 no-underline"
                >
                  <ShoppingCart size={16} />
                  购买额度
                </a>
              </div>

              <div className="bg-amber-500/10 border border-amber-400/25 rounded-xl p-3.5">
                <div className="flex items-start gap-2">
                  <Info size={14} className="text-amber-300 shrink-0 mt-0.5" />
                  <div className="text-[12px] leading-relaxed text-amber-100/90">
                    <span className="font-semibold text-amber-200">合规声明：</span>
                    本站 API 仅限合规技术研发及学术测试使用。用户须严格遵守《生成式人工智能服务管理暂行办法》，严禁利用本平台接口生成或传播违法违规内容。本平台不对用户行为承担连带法律责任。
                  </div>
                </div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-3.5">
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-200 font-medium">生成成功后自动下载图片</div>
                    <div className="text-xs text-gray-500 mt-1">自动保存到浏览器默认下载目录（仅图片，视频不自动下载；多图会逐张自动下载）</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAutoDownloadOnSuccess(!autoDownloadOnSuccess)}
                    className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${autoDownloadOnSuccess ? 'bg-blue-500/80' : 'bg-white/10'}`}
                    aria-pressed={autoDownloadOnSuccess}
                    title={autoDownloadOnSuccess ? '已开启' : '已关闭'}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${autoDownloadOnSuccess ? 'translate-x-6' : 'translate-x-1'}`}
                    />
                  </button>
                </label>
              </div>

              {/* Balance Display */}
              {balanceData && (
                <div className="bg-white/5 p-5 rounded-2xl border border-white/10 space-y-4">
                  <div className="text-center">
                    <div className="text-xs text-gray-500 mb-1 uppercase tracking-wider">剩余可用额度</div>
                    <div className="text-4xl font-mono font-bold text-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.2)] flex items-center justify-center gap-2">
                      <CoinIcon size={28} className="drop-shadow-sm" />
                      {balanceData.remaining_points}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-black/20 p-3 rounded-xl border border-white/5 text-center">
                      <div className="text-[10px] text-gray-500 mb-1">已用额度</div>
                      <div className="text-sm font-mono text-gray-300 flex items-center justify-center gap-1">
                        <CoinIcon size={14} />
                        {balanceData.used_points}
                      </div>
                    </div>
                    <div className="bg-black/20 p-3 rounded-xl border border-white/5 text-center">
                      <div className="text-[10px] text-gray-500 mb-1">总额度</div>
                      <div className="text-sm font-mono text-gray-300 flex items-center justify-center gap-1">
                        <CoinIcon size={14} />
                        {balanceData.total_points}
                      </div>
                    </div>
                  </div>
                  <div className="text-[10px] text-gray-500 text-center pt-3 border-t border-white/5 leading-relaxed">
                    {/* 规则说明已移除 */}
                  </div>
                </div>
              )}

              {/* Tech Support */}
              {/* Tech Support - Premium Card Style */}
              {/* Tech Support - Premium Card Style (Moved to bottom left absolute) */}

              {/* Announcement Manager (Hidden unless API Key is specific admin key) */}
              {isAnnouncementAdmin && (
              <div className="border border-white/10 rounded-2xl overflow-hidden bg-white/5">
                <button 
                  onClick={() => setIsAnnouncementExpanded(!isAnnouncementExpanded)}
                  className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
                >
                  <label className="text-xs font-medium text-gray-400 flex items-center gap-1.5 uppercase tracking-wider cursor-pointer">
                    <Megaphone size={12} /> 公告管理 (Admin)
                  </label>
                  <div className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300">
                    {announcementTotal} 条
                  </div>
                </button>
                
                {isAnnouncementExpanded && (
                  <div className="p-4 border-t border-white/10 space-y-4 bg-black/20">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">标题</label>
                      <input 
                        value={announcementForm.title}
                        onChange={e => setAnnouncementForm({...announcementForm, title: e.target.value})}
                        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-white/20 focus:outline-none"
                        placeholder="系统公告"
                      />
                    </div>
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setAnnouncementPage(1);
                          setAnnouncementSearchKeyword(announcementSearchInput.trim());
                          void fetchAnnouncements({
                            all: true,
                            page: 1,
                            search: announcementSearchInput.trim()
                          });
                        }}
                        disabled={isLoadingAnnouncements}
                        className="px-3 py-1.5 bg-white/10 hover:bg-white/15 text-gray-200 text-xs rounded-lg transition-all disabled:opacity-50"
                      >
                        {isLoadingAnnouncements ? '加载中...' : '加载全部公告'}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={announcementForm.active}
                          onChange={e => setAnnouncementForm({...announcementForm, active: e.target.checked})}
                          className="w-4 h-4 rounded border-gray-600 bg-black/40 text-blue-500 focus:ring-offset-0"
                        />
                        启用公告弹窗
                      </label>
                      <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={announcementForm.pinned}
                          onChange={e => setAnnouncementForm({...announcementForm, pinned: e.target.checked})}
                          className="w-4 h-4 rounded border-gray-600 bg-black/40 text-yellow-500 focus:ring-offset-0"
                        />
                        置顶公告
                      </label>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">内容</label>
                      <textarea 
                        value={announcementForm.content}
                        onChange={e => setAnnouncementForm({...announcementForm, content: e.target.value})}
                        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-white/20 focus:outline-none min-h-[100px]"
                        placeholder="输入公告内容..."
                      />
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <label className="text-xs text-gray-500">公告图片（最多 9 张）</label>
                        <div className="text-[11px] text-gray-400">{announcementImageDataUrls.length}/9</div>
                      </div>
                      <input
                        ref={announcementImageInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={handleSelectAnnouncementImages}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => announcementImageInputRef.current?.click()}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 text-xs text-gray-200 hover:bg-white/10"
                        >
                          <Upload size={12} />
                          上传图片
                        </button>
                        {announcementImageDataUrls.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setAnnouncementImageDataUrls([])}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 text-xs text-red-200 hover:bg-red-500/15"
                          >
                            <Trash2 size={12} />
                            清空图片
                          </button>
                        )}
                      </div>
                      {announcementImageDataUrls.length > 0 && (
                        <div className="mt-2 grid grid-cols-4 gap-2">
                          {announcementImageDataUrls.map((src, idx) => (
                            <div key={`${src.slice(0, 24)}-${idx}`} className="group relative overflow-hidden rounded-md border border-white/10 bg-black/30">
                              <img src={src} alt={`公告图${idx + 1}`} className="h-14 w-full object-cover" />
                              <button
                                type="button"
                                onClick={() => setAnnouncementImageDataUrls((prev) => prev.filter((_, i) => i !== idx))}
                                className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white group-hover:inline-flex"
                                title="移除图片"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-end">
                       <button
                         onClick={handleSaveAnnouncement}
                         disabled={isSavingAnnouncement}
                         className="px-4 py-2 bg-blue-600/80 hover:bg-blue-600 text-white text-xs rounded-lg flex items-center gap-2 transition-all disabled:opacity-50"
                       >
                         {isSavingAnnouncement ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                         立即发布
                       </button>
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs text-gray-400">历史公告列表</div>
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                          <input
                            value={announcementSearchInput}
                            onChange={(e) => setAnnouncementSearchInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                setAnnouncementPage(1);
                                setAnnouncementSearchKeyword(announcementSearchInput.trim());
                                void fetchAnnouncements({
                                  all: true,
                                  page: 1,
                                  search: announcementSearchInput.trim()
                                });
                              }
                            }}
                            className="w-full h-8 rounded-lg border border-white/10 bg-black/35 pl-8 pr-3 text-xs text-gray-200 placeholder-gray-500 focus:border-white/20 focus:outline-none"
                            placeholder="搜索标题或内容"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setAnnouncementPage(1);
                            setAnnouncementSearchKeyword(announcementSearchInput.trim());
                            void fetchAnnouncements({
                              all: true,
                              page: 1,
                              search: announcementSearchInput.trim()
                            });
                          }}
                          disabled={isLoadingAnnouncements}
                          className="h-8 px-3 rounded-lg border border-white/10 bg-white/5 text-xs text-gray-200 hover:bg-white/10 disabled:opacity-50"
                        >
                          搜索
                        </button>
                      </div>
                      <div className="max-h-44 overflow-y-auto rounded-lg border border-white/10 bg-black/30 sleek-scroll-y">
                        {announcementItems.length === 0 ? (
                          <div className="px-3 py-4 text-xs text-gray-500">暂无公告</div>
                        ) : (
                          announcementItems.map((item) => (
                            <div key={item.id} className="flex items-start justify-between gap-2 border-b border-white/5 px-3 py-2 last:border-b-0">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-medium text-gray-200 truncate">{item.title || '系统公告'}</span>
                                  {item.pinned && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-300">置顶</span>
                                  )}
                                  {!!item.images?.length && (
                                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">
                                      <ImageIcon size={10} />
                                      {item.images.length}
                                    </span>
                                  )}
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${item.active ? 'bg-green-500/20 text-green-300' : 'bg-gray-600/30 text-gray-400'}`}>
                                    {item.active ? '启用' : '停用'}
                                  </span>
                                </div>
                                <div className="text-[11px] text-gray-500 mt-1">
                                  {item.date ? new Date(item.date).toLocaleString() : '-'}
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => void handleTogglePinned(item.id, item.pinned === true)}
                                  disabled={pinningAnnouncementId === item.id}
                                  className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors disabled:opacity-50 ${item.pinned ? 'border-yellow-500/40 text-yellow-300 hover:bg-yellow-500/15' : 'border-white/15 text-gray-300 hover:bg-white/10'}`}
                                  title={item.pinned ? '取消置顶' : '置顶公告'}
                                >
                                  {pinningAnnouncementId === item.id ? (
                                    <Loader2 size={12} className="animate-spin" />
                                  ) : item.pinned ? (
                                    <PinOff size={12} />
                                  ) : (
                                    <Pin size={12} />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteAnnouncement(item.id)}
                                  disabled={deletingAnnouncementId === item.id}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-red-500/30 text-red-300 hover:bg-red-500/15 transition-colors disabled:opacity-50"
                                  title="删除公告"
                                >
                                  {deletingAnnouncementId === item.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-gray-400">
                        <span>共 {announcementTotal} 条</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              const target = Math.max(1, announcementPage - 1);
                              setAnnouncementPage(target);
                              void fetchAnnouncements({
                                all: true,
                                page: target,
                                search: announcementSearchKeyword
                              });
                            }}
                            disabled={announcementPage <= 1 || isLoadingAnnouncements}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-40"
                            title="上一页"
                          >
                            <ChevronLeft size={12} />
                          </button>
                          <span>{announcementPage}/{announcementTotalPages}</span>
                          <button
                            type="button"
                            onClick={() => {
                              const target = Math.min(announcementTotalPages, announcementPage + 1);
                              setAnnouncementPage(target);
                              void fetchAnnouncements({
                                all: true,
                                page: target,
                                search: announcementSearchKeyword
                              });
                            }}
                            disabled={announcementPage >= announcementTotalPages || isLoadingAnnouncements}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-40"
                            title="下一页"
                          >
                            <ChevronRight size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              )}

	              {/* Error Display */}
	              {error && (
	                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3 text-red-200 text-xs">
	                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
	                  <span>{error}</span>
	                </div>
	              )}

	              {/* Tech Support QR (in normal flow to avoid covering balance cards) */}
	              <div className="pt-2 flex flex-col items-center gap-2">
	                <div
	                  onClick={() => onViewImage && onViewImage(wechatQR)}
	                  className="bg-white/10 backdrop-blur-md rounded-xl p-2 border border-white/10 shadow-2xl group hover:scale-105 transition-transform duration-300 cursor-zoom-in"
	                  title="点击放大展示二维码"
	                >
	                  <img
	                    src={wechatQR}
	                    alt="WeChat QR"
	                    className="w-24 h-24 rounded-lg opacity-90 group-hover:opacity-100 transition-opacity"
	                  />
	                </div>
	                <div className="text-[10px] font-medium text-gray-500 uppercase tracking-[0.2em] opacity-50">
	                  扫码联系技术支持
	                </div>
	              </div>
	            </div>
	          ) : (
            /* History Tab */
            <div className="space-y-4">
              <div className="flex gap-2 bg-black/20 p-1.5 rounded-xl border border-white/5">
                <button
                  onClick={() => setHistoryMediaType('image')}
                  className={`flex-1 rounded-lg transition-all font-medium touch-manipulation active:scale-[0.98] ${isMobile ? 'text-sm py-2.5' : 'text-xs py-2'} ${historyMediaType === 'image'
                    ? 'bg-white/10 text-white shadow-sm ring-1 ring-white/10'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                    }`}
                >
                  图片历史
                </button>
                <button
                  onClick={() => setHistoryMediaType('video')}
                  className={`flex-1 rounded-lg transition-all font-medium touch-manipulation active:scale-[0.98] ${isMobile ? 'text-sm py-2.5' : 'text-xs py-2'} ${historyMediaType === 'video'
                    ? 'bg-purple-500/20 text-purple-200 shadow-sm ring-1 ring-purple-500/20'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                    }`}
                >
                  视频历史
                </button>
              </div>

              {filteredLogs.length > 0 && (
                <div className="flex justify-between items-center px-1">
                   <span className="text-xs text-gray-500">共 {filteredLogs.length} 条记录</span>
                   <button
                     onClick={handleDownloadAll}
                     disabled={isDownloadingAll}
                     className={`${isMobile ? 'text-sm min-h-9 px-2' : 'text-xs'} rounded-lg flex items-center gap-1.5 transition-colors touch-manipulation active:scale-[0.98] ${isDownloadingAll ? 'text-gray-600' : 'text-blue-400 hover:text-blue-300 active:text-blue-200'}`}
                   >
                     {isDownloadingAll ? <Loader2 size={12} className="animate-spin" /> : <DownloadCloud size={12} />}
                     全部打包下载
                   </button>
                </div>
              )}

              {filteredLogs.length > 0 ? (
                isMobile ? (
                  <div
                    ref={historyListRef}
                    onScroll={handleHistoryScroll}
                    className={`overflow-y-auto rounded-xl border border-white/10 bg-black/20 ${isHistoryScrolling ? 'select-none' : ''} max-h-[56vh]`}
                  >
                    <div style={{ height: topSpacerHeight }} />
                    {virtualLogs.map((log) => (
                      <div key={log.id} style={{ height: ROW_HEIGHT }} className="p-1.5">
                        <ResolvedHistoryItem
                          log={log}
                          historyMediaType={historyMediaType}
                          onViewImage={onViewImage}
                          handleReusePrompt={handleReusePrompt}
                          onUseAsReference={onUseAsReference}
                          onDownloadImage={onDownloadImage}
                          isMobile
                          blockActions={isHistoryScrolling}
                        />
                      </div>
                    ))}
                    <div style={{ height: bottomSpacerHeight }} />
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3 pb-8 items-start">
                    {[0, 1, 2].map((colIndex) => (
                      <div key={colIndex} className="flex flex-col gap-3">
                        {filteredLogs
                          .filter((_, i) => i % 3 === colIndex)
                          .map((log) => (
                            <ResolvedHistoryItem
                              key={log.id}
                              log={log}
                              historyMediaType={historyMediaType}
                              onViewImage={onViewImage}
                              handleReusePrompt={handleReusePrompt}
                              onUseAsReference={onUseAsReference}
                              onDownloadImage={onDownloadImage}
                            />
                          ))}
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-gray-600">
                  <History size={48} strokeWidth={1} className="mb-4 opacity-20" />
                  <p className="text-sm">暂无生成记录</p>
                  <p className="text-xs opacity-50 mt-1">您生成的图片和视频会自动保存在这里</p>
                </div>
              )}
              
              {filteredLogs.length > 0 && (
                <div className="pt-4 border-t border-white/5">
                   <button
                    onClick={handleClearHistory}
                    className={`w-full rounded-xl flex items-center justify-center gap-2 transition-all touch-manipulation active:scale-[0.98] ${isMobile ? 'py-3 text-sm' : 'py-2.5 text-xs'} ${
                        isConfirmingClear 
                        ? 'bg-red-500/20 text-red-300 border border-red-500/30' 
                        : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-300'
                    }`}
                   >
                     <Trash2 size={14} />
                     {isConfirmingClear ? '确定清空所有记录？' : '清空记录'}
                   </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
	    </GlassModal>
	  );
	};

export default SettingsModal;

