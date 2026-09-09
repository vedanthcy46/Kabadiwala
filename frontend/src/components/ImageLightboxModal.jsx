import { useState, useEffect, useCallback, useRef } from 'react';
import './ImageLightboxModal.css';

export function ImageLightboxModal() {
  const [activeImage, setActiveImage] = useState(null); // { src, alt }
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const closeLightbox = useCallback(() => {
    setActiveImage(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    document.body.style.overflow = '';
  }, []);

  const openLightbox = useCallback((src, alt = '') => {
    if (!src) return;
    setActiveImage({ src, alt });
    setZoom(1);
    setPan({ x: 0, y: 0 });
    document.body.style.overflow = 'hidden';
  }, []);

  // Global click listener to intercept clicks on any image across the web application
  useEffect(() => {
    function handleDocumentClick(e) {
      // Ignore clicks inside open lightbox modal controls or interactive maps
      if (
        e.target.closest(
          '.image-lightbox, .leaflet-container, .leaflet-pane, .leaflet-marker-icon, .leaflet-tile, .leaflet-popup, .mapboxgl-map, .mapboxgl-marker, .recyclers-map, .map-container, .no-zoom'
        )
      ) {
        return;
      }

      const target = e.target;

      // Case 1: Standard <img> element
      if (target.tagName === 'IMG' && target.src) {
        if (target.dataset.noZoom === 'true' || target.closest('.no-zoom')) return;
        // Ignore map tiles and Leaflet/Mapbox icons by URL pattern or class
        if (
          target.src.includes('tile.openstreetmap.org') ||
          target.src.includes('marker-icon') ||
          target.src.includes('marker-shadow') ||
          target.src.includes('leaflet') ||
          target.src.includes('mapbox') ||
          String(target.className).includes('leaflet') ||
          String(target.className).includes('mapbox')
        ) {
          return;
        }
        // Skip tiny empty inline SVG placeholders if any
        if (target.src.startsWith('data:image/svg+xml;utf8,<svg')) return;

        const src = target.currentSrc || target.src;
        const alt = target.alt || target.title || target.getAttribute('aria-label') || '';
        openLightbox(src, alt);
        return;
      }

      // Case 2: QR code containers (.lot-qr or .lot-qr__code)
      const qrContainer = target.closest('.lot-qr, .lot-qr__code');
      if (qrContainer) {
        const svgEl = qrContainer.querySelector('svg');
        if (svgEl) {
          const svgData = new XMLSerializer().serializeToString(svgEl);
          const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
          const url = URL.createObjectURL(svgBlob);
          const qrId = qrContainer.querySelector('.lot-qr__id')?.textContent || 'Lot QR Code';
          openLightbox(url, qrId);
          return;
        }
      }

      // Case 3: Avatar containers with background images (.profile-avatar, .recycler-card__avatar, [data-lightbox-src])
      const avatarEl = target.closest('.profile-avatar, .recycler-card__avatar, [data-lightbox-src]');
      if (avatarEl && !avatarEl.querySelector('img')) {
        const bgUrl = avatarEl.dataset.lightboxSrc || avatarEl.style.backgroundImage?.replace(/^url\(['"]?(.*?)['"]?\)$/, '$1');
        if (bgUrl && bgUrl !== 'none' && !bgUrl.includes('linear-gradient')) {
          const alt = avatarEl.getAttribute('alt') || avatarEl.title || avatarEl.getAttribute('aria-label') || 'Profile Picture';
          openLightbox(bgUrl, alt);
          return;
        }
      }
    }

    document.addEventListener('click', handleDocumentClick, true);
    return () => document.removeEventListener('click', handleDocumentClick, true);
  }, [openLightbox]);

  // Keyboard controls: ESC to close, + / - to zoom
  useEffect(() => {
    function handleKeyDown(e) {
      if (!activeImage) return;
      if (e.key === 'Escape') {
        closeLightbox();
      } else if (e.key === '+' || e.key === '=') {
        setZoom((prev) => Math.min(prev + 0.35, 3.5));
      } else if (e.key === '-') {
        setZoom((prev) => Math.max(prev - 0.35, 0.5));
      } else if (e.key === '0') {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeImage, closeLightbox]);

  if (!activeImage) return null;

  const handleZoomIn = (e) => {
    e.stopPropagation();
    setZoom((prev) => Math.min(prev + 0.35, 3.5));
  };

  const handleZoomOut = (e) => {
    e.stopPropagation();
    setZoom((prev) => Math.max(prev - 0.35, 0.5));
  };

  const handleResetZoom = (e) => {
    e.stopPropagation();
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleToggleZoom = (e) => {
    e.stopPropagation();
    if (zoom === 1) {
      setZoom(2);
    } else {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
  };

  const handleDownload = (e) => {
    e.stopPropagation();
    const link = document.createElement('a');
    link.href = activeImage.src;
    const cleanName = (activeImage.alt || 'maximized_image').replace(/[^a-z0-9_-]/gi, '_');
    link.download = `${cleanName}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleOpenNewTab = (e) => {
    e.stopPropagation();
    window.open(activeImage.src, '_blank');
  };

  // Mouse drag handling when zoomed in
  const handleMouseDown = (e) => {
    if (zoom <= 1) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleMouseMove = (e) => {
    if (!isDragging || zoom <= 1) return;
    setPan({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  return (
    <div
      className="image-lightbox animate-fade-in"
      onClick={closeLightbox}
      role="dialog"
      aria-modal="true"
      aria-label="Maximized Image View"
    >
      {/* Top Controls Header */}
      <header className="image-lightbox__header" onClick={(e) => e.stopPropagation()}>
        <div className="image-lightbox__caption">
          <span className="image-lightbox__title">
            {activeImage.alt || 'Maximized Image View'}
          </span>
          <span className="image-lightbox__hint hide-mobile">
            Click image to toggle 2x zoom · Drag to move · Esc to close
          </span>
        </div>

        <div className="image-lightbox__actions">
          <button
            type="button"
            className="image-lightbox__btn"
            onClick={handleZoomOut}
            title="Zoom Out (-)"
            aria-label="Zoom Out"
          >
            ➖
          </button>
          <span className="image-lightbox__zoom-text">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="image-lightbox__btn"
            onClick={handleZoomIn}
            title="Zoom In (+)"
            aria-label="Zoom In"
          >
            ➕
          </button>
          <button
            type="button"
            className="image-lightbox__btn"
            onClick={handleResetZoom}
            title="Reset Zoom (100%)"
            aria-label="Reset Zoom"
          >
            ↺
          </button>
          <div className="image-lightbox__divider" />
          <button
            type="button"
            className="image-lightbox__btn"
            onClick={handleOpenNewTab}
            title="Open in new tab"
            aria-label="Open in new tab"
          >
            ↗️
          </button>
          <button
            type="button"
            className="image-lightbox__btn"
            onClick={handleDownload}
            title="Download Image"
            aria-label="Download Image"
          >
            ⬇️
          </button>
          <button
            type="button"
            className="image-lightbox__btn image-lightbox__btn--close"
            onClick={closeLightbox}
            title="Close (Esc)"
            aria-label="Close Lightbox"
          >
            ✕
          </button>
        </div>
      </header>

      {/* Main Fullscreen Image View Stage */}
      <div
        className="image-lightbox__stage"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <img
          src={activeImage.src}
          alt={activeImage.alt || 'Maximized view'}
          className={`image-lightbox__img ${zoom > 1 ? 'image-lightbox__img--zoomed' : ''}`}
          style={{
            transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in',
          }}
          onClick={handleToggleZoom}
        />
      </div>
    </div>
  );
}
