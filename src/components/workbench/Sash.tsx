"use client";
import { useRef } from "react";
import { uiZoom } from "@/components/ui/menu";

/**
 * VS Code-style resize handle. Reports the pointer delta since drag start on every
 * move (`onDrag`) and once more on release (`onEnd`), so callers can mutate the DOM
 * live and commit to the store only once. Keyboard: ←/→ (or ↑/↓) nudge by 10px.
 */
export default function Sash({
  orientation,
  onStart,
  onDrag,
  onEnd,
  onReset,
  onNudge,
  label,
  className = "",
}: {
  orientation: "vertical" | "horizontal";
  onStart?: () => void;
  onDrag: (delta: number) => void;
  onEnd: (delta: number) => void;
  onReset: () => void;
  onNudge?: (delta: number) => void;
  label: string;
  className?: string;
}) {
  const start = useRef<number | null>(null);
  const last = useRef(0);
  const vertical = orientation === "vertical";

  return (
    <div
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-label={label}
      title={`${label} — drag to resize, double-click to reset`}
      tabIndex={0}
      className={`sash group relative z-20 shrink-0 select-none touch-none outline-none ${vertical ? "-mx-[2px] w-[5px] cursor-col-resize" : "-my-[2px] h-[5px] cursor-row-resize"} ${className}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = vertical ? e.clientX : e.clientY;
        last.current = 0;
        document.body.dataset.resizing = vertical ? "col" : "row";
        onStart?.();
      }}
      onPointerMove={(e) => {
        if (start.current === null) return;
        // Pointer coordinates are visual px; layout sizes are CSS px (differ under workbench.zoomLevel).
        last.current = ((vertical ? e.clientX : e.clientY) - start.current) / uiZoom();
        onDrag(last.current);
      }}
      onPointerUp={(e) => {
        if (start.current === null) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        start.current = null;
        delete document.body.dataset.resizing;
        onEnd(last.current);
      }}
      onPointerCancel={() => {
        start.current = null;
        delete document.body.dataset.resizing;
        onEnd(last.current);
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (!onNudge) return;
        const k = e.key;
        const step = e.shiftKey ? 40 : 10;
        if ((vertical && k === "ArrowLeft") || (!vertical && k === "ArrowUp")) (e.preventDefault(), onNudge(-step));
        else if ((vertical && k === "ArrowRight") || (!vertical && k === "ArrowDown")) (e.preventDefault(), onNudge(step));
        else if (k === "Enter") (e.preventDefault(), onReset());
      }}
    >
      <span
        className={`absolute bg-transparent transition-colors delay-150 group-hover:bg-accent group-focus-visible:bg-accent group-active:bg-accent group-active:delay-0 ${
          vertical ? "inset-y-0 left-[0.5px] w-[4px]" : "inset-x-0 top-[0.5px] h-[4px]"
        }`}
      />
    </div>
  );
}
