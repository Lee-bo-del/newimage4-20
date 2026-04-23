import React, { useEffect } from 'react';
import { useSelectionStore } from '../src/store/selectionStore';
import { Banana } from 'lucide-react';
import DropUpSelect from './DropUpSelect';
import ModelSelector from './ModelSelector';
import { OpenAILogo } from './Logos';

export const ImageFormConfig: React.FC = () => {
  const {
    aspectRatio,
    setAspectRatio,
    customRatio,
    setCustomRatio,
    imageSize,
    setImageSize,
    quantity,
    setQuantity,
    imageModel,
    setImageModel,
    imageLine,
    setImageLine,
  } = useSelectionStore();

  useEffect(() => {
    // Keep supported image models after hydration.
    const supportedModels = new Set(['nano-banana', 'gpt-image-2']);
    if (!supportedModels.has(imageModel)) {
      setImageModel('nano-banana');
    }
  }, [imageModel, setImageModel]);

  const ratioOptions = [
    { label: '\u667A\u80FD', value: 'Smart' },
    { label: '\u81EA\u5B9A\u4E49', value: 'Custom' },
    { label: '1:1', value: '1:1' },
    { label: '16:9', value: '16:9' },
    { label: '9:16', value: '9:16' },
    { label: '4:3', value: '4:3' },
    { label: '3:4', value: '3:4' },
    { label: '3:2', value: '3:2' },
    { label: '2:3', value: '2:3' },
    { label: '21:9', value: '21:9' },
    { label: '9:21', value: '9:21' },
    { label: '5:4', value: '5:4' },
  ];

  const isNanoBanana = imageModel === 'nano-banana';
  const nanoBananaCost = imageLine === 'line3' ? 5 : 14;
  const gridClass = isNanoBanana
    ? 'grid-cols-[1.2fr_1fr_1.2fr_0.8fr] gap-1.5'
    : 'grid-cols-[1.4fr_1fr_0.8fr] gap-1.5';

  return (
    <>
      <div className="mb-2">
        <label className="block text-[10px] text-gray-500 mb-1">{'\u751F\u56FE\u6A21\u578B'}</label>
        <ModelSelector
          dropUp
          value={imageModel}
          onChange={(val) => setImageModel(val)}
          options={[
            {
              value: 'nano-banana',
              label: 'Nano Banana Pro',
              cost: nanoBananaCost,
              icon: (
                <div className="flex items-center gap-0.5">
                  <Banana size={12} className="text-yellow-400" />
                  <Banana size={12} className="text-yellow-400" />
                </div>
              ),
            },
            {
              value: 'gpt-image-2',
              label: 'GPT-image-2',
              cost: 1,
              icon: <OpenAILogo />,
            },
          ]}
        />
      </div>

      <div className={`grid ${gridClass}`}>
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">{'\u6BD4\u4F8B'}</label>
          <DropUpSelect
            value={aspectRatio}
            onChange={(val) => setAspectRatio(val)}
            options={ratioOptions}
          />
          {aspectRatio === 'Custom' && (
            <div className="flex items-center gap-1 mt-1">
              <input
                type="text"
                value={customRatio}
                onChange={(e) => setCustomRatio(e.target.value)}
                placeholder="16:9"
                className="w-full bg-gray-900 border border-gray-700 rounded px-1 py-1 text-[10px] text-white"
              />
            </div>
          )}
        </div>

        <div>
          <label className="block text-[10px] text-gray-500 mb-1">{'\u5C3A\u5BF8'}</label>
          <DropUpSelect
            value={imageSize}
            onChange={(val) => setImageSize(val)}
            options={[
              { value: '1k', label: '1K' },
              { value: '2k', label: '2K' },
              { value: '4k', label: '4K' },
            ]}
          />
        </div>

        {isNanoBanana && (
          <div>
            <label className="block text-[10px] text-gray-500 mb-1">{'\u7EBF\u8DEF'}</label>
            <DropUpSelect
              value={imageLine}
              onChange={(val) => setImageLine(val)}
              options={[
                { value: 'line1', label: '\u7EBF\u8DEF\u4E00' },
                { value: 'line2', label: '\u7EBF\u8DEF\u4E8C' },
                { value: 'line3', label: '\u7EBF\u8DEF\u4E09' },
              ]}
            />
          </div>
        )}

        <div>
          <label className="block text-[10px] text-gray-500 mb-1">{'\u6570\u91CF'}</label>
          <DropUpSelect
            value={String(quantity)}
            onChange={(val) => setQuantity(parseInt(val, 10))}
            options={[
              { value: '1', label: '1' },
              { value: '2', label: '2' },
              { value: '4', label: '4' },
            ]}
          />
        </div>
      </div>
    </>
  );
};

export default ImageFormConfig;
