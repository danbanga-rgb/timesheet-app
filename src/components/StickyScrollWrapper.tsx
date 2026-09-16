import { useEffect, useRef, useState, type ReactNode } from 'react';

// Wraps a scrollable content area (usually a wide table) with a sticky-bottom
// mirror scrollbar. The mirror stays visible even when the natural scrollbar
// scrolls off-screen, so users can pan a wide table without scrolling to the
// bottom of the page first. Scroll positions are synced both ways via
// requestAnimationFrame to avoid feedback loops. Table width is tracked with
// ResizeObserver so the mirror stays sized correctly as content grows.
//
// When maxHeight is set, the outer container also handles vertical scrolling
// so that sticky-top table headers stay anchored while rows scroll.
//
// Extracted from TimesheetSystem.tsx as Slice W1 of the accountant
// modularization arc (2026-09-16).

export interface StickyScrollWrapperProps {
  children: ReactNode;
  className?: string;
  maxHeight?: string;
}

export default function StickyScrollWrapper({ children, className, maxHeight }: StickyScrollWrapperProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  const [tableWidth, setTableWidth] = useState(0);

  useEffect(() => {
    const outer = outerRef.current;
    const mirror = mirrorRef.current;
    if (!outer || !mirror) return;
    const onOuter = () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      mirror.scrollLeft = outer.scrollLeft;
      requestAnimationFrame(() => { syncingRef.current = false; });
    };
    const onMirror = () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      outer.scrollLeft = mirror.scrollLeft;
      requestAnimationFrame(() => { syncingRef.current = false; });
    };
    outer.addEventListener('scroll', onOuter);
    mirror.addEventListener('scroll', onMirror);
    const ro = new ResizeObserver(() => setTableWidth(outer.scrollWidth));
    ro.observe(outer);
    setTableWidth(outer.scrollWidth);
    return () => {
      outer.removeEventListener('scroll', onOuter);
      mirror.removeEventListener('scroll', onMirror);
      ro.disconnect();
    };
  }, []);

  const outerStyle = maxHeight ? { maxHeight } : undefined;
  const outerOverflow = maxHeight ? 'overflow-auto' : 'overflow-x-auto';
  return (
    <div>
      <div ref={outerRef} style={outerStyle} className={`${outerOverflow} -mx-3 sm:mx-0 px-3 sm:px-0 ${className ?? ''}`}>
        {children}
      </div>
      <div ref={mirrorRef} className="overflow-x-scroll sticky bottom-0 -mx-3 sm:mx-0 bg-white border-t border-gray-100" style={{ height: 14 }}>
        <div style={{ width: tableWidth, height: 1 }} />
      </div>
    </div>
  );
}
