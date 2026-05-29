import { useRef, useCallback, useEffect } from 'react';

interface ResizerProps {
  axis: 'x' | 'y';
  currentSize: number;
  minSize: number;
  maxSize: number;
  onResize: (size: number) => void;
  targetRef: React.RefObject<HTMLElement | null>;
}

export function Resizer({ axis, currentSize, minSize, maxSize, onResize, targetRef }: ResizerProps) {
  const draggingRef = useRef(false);
  const startMouseRef = useRef(0);
  const startSizeRef = useRef(currentSize);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      draggingRef.current = true;
      startMouseRef.current = axis === 'x' ? e.clientX : e.clientY;

      // Lock start size to actual DOM measurement
      const el = targetRef.current;
      if (el) {
        if (axis === 'x') {
          startSizeRef.current = el.getBoundingClientRect().width;
        } else {
          startSizeRef.current = el.getBoundingClientRect().height;
        }
        // Kill CSS transitions during drag so every pixel tracks instantly
        el.style.transition = 'none';
      } else {
        startSizeRef.current = currentSize;
      }

      document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [axis, currentSize, targetRef],
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;

      const currentMouse = axis === 'x' ? e.clientX : e.clientY;
      const delta = currentMouse - startMouseRef.current;
      // y-axis: dragging UP increases size → invert delta
      const sizeDelta = axis === 'x' ? delta : -delta;
      const newSize = Math.min(maxSize, Math.max(minSize, startSizeRef.current + sizeDelta));

      // Direct DOM write — zero-latency pixel tracking
      const el = targetRef.current;
      if (!el) return;

      if (axis === 'x') {
        el.style.width = `${newSize}px`;
      } else {
        el.style.height = `${newSize}px`;
        el.style.maxHeight = `${newSize}px`;
      }
    };

    const onMouseUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;

      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      const el = targetRef.current;
      if (!el) return;

      // Read final size from the DOM while our inline values are still in place
      const finalSize = Math.round(
        axis === 'x'
          ? el.getBoundingClientRect().width
          : el.getBoundingClientRect().height,
      );

      // Sync to React state.  React's next commit will set style.maxHeight
      // (or style.width) to the same size we already wrote — so there is no
      // visual change.  We deliberately keep our inline values; clearing them
      // would cause a snap-back to the old React state before the re-render.
      onResizeRef.current(finalSize);

      // Restore CSS transition for future expand/collapse animations.
      // Double rAF: 1st = React flush, 2nd = post-commit safe to touch style.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.transition = '';
        });
      });
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [axis, minSize, maxSize, targetRef]);

  const isX = axis === 'x';

  return (
    <div
      className={`flex-shrink-0 relative bg-transparent hover:bg-[var(--accent)] transition-colors duration-150 group ${
        isX ? 'w-[4px] cursor-col-resize' : 'h-[4px] cursor-row-resize'
      }`}
      onMouseDown={onMouseDown}
    >
      {/* Invisible wider hit area for easier grabbing */}
      <div
        className={`absolute bg-transparent ${
          isX ? '-inset-x-1 inset-y-0' : 'inset-x-0 -inset-y-1'
        }`}
      />
    </div>
  );
}
