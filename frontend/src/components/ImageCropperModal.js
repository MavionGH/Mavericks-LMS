"use client";

import { useState, useEffect, useRef } from "react";

export default function ImageCropperModal({
  imageSrc,
  onCrop,
  onClose,
  aspectRatio = 16 / 9
}) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const dragOffsetStart = useRef({ x: 0, y: 0 });
  const imageRef = useRef(null);
  const containerRef = useRef(null);

  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Calculate baseline image size (object-fit: cover equivalent)
  useEffect(() => {
    if (!imageSrc) return;
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      const containerWidth = containerRef.current?.offsetWidth || 400;
      const containerHeight = containerWidth / aspectRatio;
      setContainerSize({ width: containerWidth, height: containerHeight });

      const imgAspect = img.width / img.height;
      const containerAspect = aspectRatio;

      let baselineWidth = 0;
      let baselineHeight = 0;

      if (imgAspect > containerAspect) {
        // Image is wider
        baselineHeight = containerHeight;
        baselineWidth = containerHeight * imgAspect;
      } else {
        // Image is taller or square
        baselineWidth = containerWidth;
        baselineHeight = containerWidth / imgAspect;
      }

      setImageSize({ width: baselineWidth, height: baselineHeight });
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
  }, [imageSrc, aspectRatio]);

  // Clamp offsets so the image always covers the viewport
  const clampOffset = (x, y, currentZoom) => {
    if (imageSize.width === 0 || containerSize.width === 0) return { x, y };

    const maxX = Math.max(0, (imageSize.width * currentZoom - containerSize.width) / 2);
    const maxY = Math.max(0, (imageSize.height * currentZoom - containerSize.height) / 2);

    return {
      x: Math.min(Math.max(x, -maxX), maxX),
      y: Math.min(Math.max(y, -maxY), maxY)
    };
  };

  // Adjust offset when zoom changes to prevent blank margins
  const handleZoomChange = (e) => {
    const newZoom = parseFloat(e.target.value);
    setZoom(newZoom);
    setOffset((prev) => clampOffset(prev.x, prev.y, newZoom));
  };

  // Mouse / Touch Event Handlers for Dragging
  const handleStart = (clientX, clientY) => {
    setIsDragging(true);
    dragStart.current = { x: clientX, y: clientY };
    dragOffsetStart.current = { ...offset };
  };

  const handleMove = (clientX, clientY) => {
    if (!isDragging) return;
    const dx = clientX - dragStart.current.x;
    const dy = clientY - dragStart.current.y;

    const newX = dragOffsetStart.current.x + dx;
    const newY = dragOffsetStart.current.y + dy;

    setOffset(clampOffset(newX, newY, zoom));
  };

  const handleEnd = () => {
    setIsDragging(false);
  };

  // Handle Save Crop
  const handleSave = () => {
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      // Output size
      canvas.width = 640;
      canvas.height = 640 / aspectRatio;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Translate context to center, apply scale & offsets, and draw
      const scaleFactor = canvas.width / containerSize.width;
      
      ctx.translate(canvas.width / 2 + offset.x * scaleFactor, canvas.height / 2 + offset.y * scaleFactor);
      ctx.scale(zoom * scaleFactor, zoom * scaleFactor);

      // Baseline size relative to container
      ctx.drawImage(
        img,
        -imageSize.width / 2,
        -imageSize.height / 2,
        imageSize.width,
        imageSize.height
      );

      canvas.toBlob((blob) => {
        if (blob) {
          onCrop(blob);
        }
      }, "image/jpeg", 0.9);
    };
  };

  return (
    <div className="crop-modal-backdrop">
      <div className="crop-modal-card">
        <div className="crop-modal-header">
          <h3 className="crop-modal-title">Position and Size Course Image</h3>
          <button className="crop-modal-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div
          ref={containerRef}
          className="crop-modal-viewport"
          style={{ aspectRatio }}
          onMouseDown={(e) => handleStart(e.clientX, e.clientY)}
          onMouseMove={(e) => handleMove(e.clientX, e.clientY)}
          onMouseUp={handleEnd}
          onMouseLeave={handleEnd}
          onTouchStart={(e) => {
            if (e.touches.length === 1) {
              handleStart(e.touches[0].clientX, e.touches[0].clientY);
            }
          }}
          onTouchMove={(e) => {
            if (e.touches.length === 1) {
              handleMove(e.touches[0].clientX, e.touches[0].clientY);
            }
          }}
          onTouchEnd={handleEnd}
        >
          {imageSrc && (
            <img
              ref={imageRef}
              src={imageSrc}
              alt="To crop"
              draggable="false"
              className="crop-modal-image"
              style={{
                width: imageSize.width || "auto",
                height: imageSize.height || "auto",
                transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                cursor: isDragging ? "grabbing" : "grab"
              }}
            />
          )}
        </div>

        <div className="crop-modal-controls">
          <div className="crop-modal-slider-group">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--text-muted)" }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
            <input
              type="range"
              min="1"
              max="3"
              step="0.01"
              value={zoom}
              onChange={handleZoomChange}
              className="crop-modal-zoom-slider"
            />
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--brand)" }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </div>
        </div>

        <div className="crop-modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            Apply Crop
          </button>
        </div>
      </div>
    </div>
  );
}
