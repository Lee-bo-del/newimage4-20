import React from 'react';
import { useSelectionStore } from '../src/store/selectionStore';
import { Sparkles } from 'lucide-react';
import ModelSelector from './ModelSelector';

const GoogleLogo = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" className="inline-block">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.84z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

export const VideoFormConfig: React.FC = () => {
  const {
    videoModel,
    setVideoModel,
    videoAspectRatio,
    setVideoAspectRatio,
    videoDuration,
    setVideoDuration,
    videoHd,
    setVideoHd,
  } = useSelectionStore();

  React.useEffect(() => {
    if (videoModel === 'veo3.1-4k') {
      setVideoModel('veo3.1-fast-4K');
      return;
    }
    if (videoModel === 'veo3.1-components-4k') {
      setVideoModel('veo3.1-fast-components-4K');
      return;
    }
    if (videoModel.startsWith('sora-2')) {
      // Removed sora models: fallback to default veo model.
      setVideoModel('veo3.1-fast');
    }
  }, [videoModel, setVideoModel]);

  const isGrokModel = videoModel.startsWith('grok');

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">{'\u6BD4\u4F8B'}</label>
          <select
            value={videoAspectRatio}
            onChange={(e) => setVideoAspectRatio(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-2 text-xs text-white"
          >
            {isGrokModel ? (
              <>
                <option value="16:9">16:9 ({'\u6A2A\u5C4F'})</option>
                <option value="9:16">9:16 ({'\u7AD6\u5C4F'})</option>
                <option value="2:3">2:3</option>
                <option value="3:2">3:2</option>
                <option value="1:1">1:1</option>
              </>
            ) : (
              <>
                <option value="16:9">16:9 ({'\u6A2A\u5C4F'})</option>
                <option value="9:16">9:16 ({'\u7AD6\u5C4F'})</option>
              </>
            )}
          </select>
        </div>

        <div>
          <label className="block text-[10px] text-gray-500 mb-1">{'\u65F6\u957F (\u79D2)'}</label>
          <select
            value={videoDuration}
            onChange={(e) => setVideoDuration(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-2 text-xs text-white"
          >
            {isGrokModel ? (
              <>
                <option value="5">5s</option>
                <option value="10">10s</option>
                <option value="15">15s</option>
              </>
            ) : (
              <>
                <option value="4">4s</option>
                <option value="6">6s</option>
                <option value="8">8s</option>
              </>
            )}
          </select>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-[10px] text-gray-500">{'\u89C6\u9891\u6A21\u578B'}</label>
          {isGrokModel && (
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={videoHd}
                onChange={(e) => setVideoHd(e.target.checked)}
                className="w-3 h-3 rounded bg-gray-700 border-gray-600 text-purple-600 focus:ring-purple-500"
              />
              <span className="text-[10px] text-purple-300 font-medium">1080P HD</span>
            </label>
          )}
        </div>

        <ModelSelector
          dropUp
          value={videoModel}
          onChange={(val) => {
            setVideoModel(val);
            if (val.startsWith('grok')) {
              setVideoDuration('5');
              setVideoAspectRatio('1:1');
              setVideoHd(false);
            } else {
              setVideoDuration('4');
              if (videoAspectRatio !== '16:9' && videoAspectRatio !== '9:16') {
                setVideoAspectRatio('16:9');
              }
              setVideoHd(false);
            }
          }}
          options={[
            { value: 'veo3.1-fast', label: 'Veo 3.1 Fast', cost: 5, icon: <GoogleLogo /> },
            { value: 'veo3.1-components', label: 'Veo 3.1 Components', cost: 7.5, icon: <GoogleLogo /> },
            { value: 'grok-video-3', label: 'Grok Video 3', cost: 12.5, icon: <Sparkles size={14} /> },
            { value: 'veo3.1-pro', label: 'Veo 3.1 Pro', cost: 25, icon: <GoogleLogo /> },
            { value: 'veo3.1-fast-4K', label: 'Veo 3.1 Fast 4K', cost: 50, icon: <GoogleLogo /> },
            { value: 'veo3.1-fast-components-4K', label: 'Veo 3.1 Fast Components 4K', cost: 50, icon: <GoogleLogo /> },
            { value: 'veo3.1-pro-4k', label: 'Veo 3.1 Pro 4K', cost: 50, icon: <GoogleLogo /> },
          ]}
        />
      </div>
    </div>
  );
};

export default VideoFormConfig;
