import { ImageOff } from 'lucide-react';
import { useState } from 'react';

/** Изображение с плавным появлением и заглушкой, если фото нет или оно не загрузилось. */
export function ProductImage({ src, alt, eager = false }: { src?: string | null; alt: string; eager?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="img-placeholder" aria-label={alt}>
        <ImageOff size={22} strokeWidth={1.5} />
      </div>
    );
  }

  return (
    <img
      className={`product-img ${loaded ? 'is-loaded' : ''}`}
      src={src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />
  );
}
