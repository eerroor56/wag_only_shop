import { useEffect, useRef, useState } from 'react';
import type { ImageDTO } from '@wag/shared';
import { ProductImage } from './ProductImage';

/** Горизонтальная карусель на CSS scroll-snap: нативная инерция свайпа на iOS и Android. */
export function Gallery({ images, title }: { images: ImageDTO[]; title: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const index = Math.round(track.scrollLeft / Math.max(track.clientWidth, 1));
        setActive(Math.min(Math.max(index, 0), images.length - 1));
      });
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      track.removeEventListener('scroll', onScroll);
    };
  }, [images.length]);

  const goTo = (index: number) => {
    const track = trackRef.current;
    track?.scrollTo({ left: index * track.clientWidth, behavior: 'smooth' });
  };

  if (!images.length) {
    return (
      <div className="gallery">
        <div className="gallery-slide">
          <ProductImage src={null} alt={title} />
        </div>
      </div>
    );
  }

  return (
    <div className="gallery">
      <div className="gallery-track" ref={trackRef} aria-roledescription="карусель">
        {images.map((img, i) => (
          <div className="gallery-slide" key={img.id} aria-label={`Фото ${i + 1} из ${images.length}`}>
            <ProductImage src={img.url} alt={`${title} — фото ${i + 1}`} eager={i === 0} />
          </div>
        ))}
      </div>
      {images.length > 1 && (
        <div className="gallery-dots" role="tablist">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={`Показать фото ${i + 1}`}
              className={`gallery-dot ${i === active ? 'is-active' : ''}`}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
