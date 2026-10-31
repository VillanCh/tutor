import { ImagePlus, X } from 'lucide-react';
import { Button } from './components/ui/button';

export default function ReferenceImages({
  images = [],
  onRemove,
  onPreview,
  disabled = false,
  hint = false,
}) {
  return (
    <div className="reference-images">
      {images.length > 0 && (
        <div className="reference-grid">
          {images.map((image) => (
            <div className="reference-item" key={image.id}>
              <button
                type="button"
                className="reference-preview"
                onClick={() => onPreview?.(image)}
                aria-label={'查看参考图片：' + image.name}
              >
                <img src={image.dataUrl || image.src} alt={image.name} />
              </button>
              <span title={image.name}>{image.name}</span>
              {onRemove && (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="remove-reference"
                  aria-label={'移除参考图片：' + image.name}
                  onClick={() => onRemove(image.id)}
                  disabled={disabled}
                >
                  <X size={12} />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {hint && (
        <p className="reference-hint">
          <ImagePlus size={12} /> 可粘贴截图或拖入图片 · 最多 4 张，每张 5 MB
        </p>
      )}
    </div>
  );
}
