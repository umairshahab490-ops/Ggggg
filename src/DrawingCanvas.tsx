/**
 * DrawingCanvas.tsx
 * ---------------------------------------------------------------------------
 * Phase 2 freehand ink layer for the OneNote Clone page surface.
 *
 * Architecture:
 *   • A <canvas> overlay sits on top of the paper, sized to the scrollable
 *     page content via a ResizeObserver, and is DPR-aware for crisp strokes.
 *   • Strokes are captured as structured `DrawingStroke[]` (pointer events,
 *     coalesced samples) — never as bitmaps — so ink stays editable.
 *   • Undo/redo operate on an in-memory stroke history; the committed model
 *     is pushed upward through `onChange` (debounced by the parent store).
 *   • Erasing removes whole strokes hit-tested against their sample points.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { DrawingData, DrawingStroke, NoteDrawings } from './types';

/* ==========================================================================
 * Types & constants
 * ======================================================================== */

export type InkTool = 'pen' | 'pencil' | 'highlighter' | 'eraser';

export interface DrawingCanvasHandle {
  undo: () => void;
  redo: () => void;
  clearAll: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export interface DrawingToolbarState {
  tool: InkTool;
  color: string;
  /** Relative size multiplier (0.5 – 3). */
  size: number;
}

interface DrawingCanvasProps {
  /** Committed drawings for the active note (structured or legacy string). */
  value: NoteDrawings;
  /** Invoked whenever the stroke model changes (after each gesture / undo). */
  onChange: (drawings: DrawingData) => void;
  /** Whether the ink layer accepts pointer input (Draw tab toggle). */
  enabled: boolean;
  /** Handle ref so the ribbon can drive undo/redo/clear. */
  handleRef: RefObject<DrawingCanvasHandle>;
  /** Toolbar-controlled ink settings (lifted so the ribbon owns them). */
  toolbar: DrawingToolbarState;
}

const TOOL_WIDTHS: Readonly<Record<Exclude<InkTool, 'eraser'>, number>> = {
  pen: 3,
  pencil: 1.6,
  highlighter: 16,
};

const ERASER_HIT_RADIUS = 10;
const HIGHLIGHTER_ALPHA = 0.35;
const MIN_POINTS_PER_STROKE = 2;

/* ==========================================================================
 * Value normalization — accept structured data or legacy serialized strings
 * ======================================================================== */

function emptyDrawingData(): DrawingData {
  return { strokes: [], flattenedImage: null, size: { width: 0, height: 0 } };
}

function isDrawingStroke(value: unknown): value is DrawingStroke {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    Array.isArray(s.points) &&
    typeof s.color === 'string' &&
    typeof s.width === 'number' &&
    typeof s.opacity === 'number' &&
    (s.tool === 'pen' || s.tool === 'pencil' || s.tool === 'highlighter' || s.tool === 'eraser')
  );
}

export function normalizeDrawings(value: NoteDrawings): DrawingData {
  if (typeof value === 'object' && value !== null) {
    const strokes = Array.isArray(value.strokes) ? value.strokes.filter(isDrawingStroke) : [];
    return { strokes, flattenedImage: null, size: value.size ?? { width: 0, height: 0 } };
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null) {
        return normalizeDrawings(parsed as DrawingData);
      }
    } catch {
      // Not JSON — treat as opaque legacy payload with no editable strokes.
    }
  }
  return emptyDrawingData();
}

/* ==========================================================================
 * Rendering helpers
 * ======================================================================== */

function configureContext(ctx: CanvasRenderingContext2D, stroke: DrawingStroke): void {
  ctx.globalAlpha = stroke.tool === 'highlighter' ? HIGHLIGHTER_ALPHA : stroke.opacity;
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = stroke.tool === 'highlighter' ? 'butt' : 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: DrawingStroke): void {
  const { points } = stroke;
  if (points.length === 0) return;
  configureContext(ctx, stroke);

  if (points.length < MIN_POINTS_PER_STROKE) {
    // Dot: render a small disc so taps leave visible ink.
    ctx.beginPath();
    ctx.fillStyle = stroke.color;
    ctx.arc(points[0].x, points[0].y, Math.max(stroke.width / 2, 1), 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  // Quadratic smoothing through midpoints gives natural pen curves.
  for (let i = 1; i < points.length - 1; i += 1) {
    const current = points[i];
    const next = points[i + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    ctx.quadraticCurveTo(current.x, current.y, midX, midY);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

function redrawAll(
  canvas: HTMLCanvasElement,
  strokes: DrawingStroke[],
  liveStroke: DrawingStroke | null,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  for (const stroke of strokes) {
    if (stroke.tool !== 'eraser') drawStroke(ctx, stroke);
  }
  if (liveStroke && liveStroke.tool !== 'eraser') drawStroke(ctx, liveStroke);
}

/** Distance from point `p` to segment `a`→`b` (for eraser hit-testing). */
function distanceToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function strokeHitTest(stroke: DrawingStroke, point: { x: number; y: number }): boolean {
  const threshold = ERASER_HIT_RADIUS + stroke.width / 2;
  const { points } = stroke;
  if (points.length === 1) {
    return Math.hypot(point.x - points[0].x, point.y - points[0].y) <= threshold;
  }
  for (let i = 0; i < points.length - 1; i += 1) {
    if (distanceToSegment(point, points[i], points[i + 1]) <= threshold) return true;
  }
  return false;
}

function makeStrokeId(): string {
  const cryptoRef = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return `ink_${cryptoRef.randomUUID()}`;
  }
  return `ink_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/* ==========================================================================
 * Component
 * ======================================================================== */

export default function DrawingCanvas({
  value,
  onChange,
  enabled,
  handleRef,
  toolbar,
}: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const tool = toolbar.tool;
  const color = toolbar.color;
  const size = toolbar.size;

  const strokesRef = useRef<DrawingStroke[]>(normalizeDrawings(value).strokes);
  const undoStackRef = useRef<DrawingStroke[][]>([]);
  const redoStackRef = useRef<DrawingStroke[][]>([]);
  const liveStrokeRef = useRef<DrawingStroke | null>(null);
  const drawingPointerRef = useRef<number | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  /** Stroke ids currently owned by this canvas instance (see re-seed below). */
  const localIdsRef = useRef<Set<string>>(
    new Set(normalizeDrawings(value).strokes.map((stroke) => stroke.id)),
  );

  /* Stable signature of the incoming stroke-id list. */
  const valueKey = useMemo(
    () => normalizeDrawings(value).strokes.map((stroke) => stroke.id).join('|'),
    [value],
  );

  /*
   * Re-seed from props only when the *external* payload references strokes we
   * did not author ourselves (i.e. the user navigated to a different page).
   * This prevents our own onChange round-trip from clobbering in-flight ink.
   */
  useEffect(() => {
    const incoming = normalizeDrawings(value).strokes;
    const incomingIds = incoming.map((stroke) => stroke.id);
    const isForeignPayload = incomingIds.some((id) => !localIdsRef.current.has(id));
    const isOwnEcho =
      incomingIds.length === localIdsRef.current.size &&
      [...localIdsRef.current].every((id) => incomingIds.includes(id)) &&
      !isForeignPayload;

    if (isOwnEcho) {
      // Same stroke set we just committed — keep history and refs intact.
      return;
    }

    strokesRef.current = incoming;
    localIdsRef.current = new Set(incomingIds);
    undoStackRef.current = [];
    redoStackRef.current = [];
    liveStrokeRef.current = null;
    setHistoryVersion((v) => v + 1);
    const canvas = canvasRef.current;
    if (canvas) redrawAll(canvas, incoming, null);
    // Intentionally keyed on the id-signature only; `value` object identity
    // changes on every keystroke elsewhere and must not reset the ink layer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueKey]);

  /* Size the canvas to its container (which mirrors the paper surface). */
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const applySize = (): void => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(Math.round(rect.width), 1);
      const height = Math.max(Math.round(rect.height), 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      strokesRef.current = strokesRef.current.map((stroke) => ({ ...stroke }));
      redrawAll(canvas, strokesRef.current, liveStrokeRef.current);
    };

    applySize();
    const observer = new ResizeObserver(applySize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const commitStrokes = useCallback(
    (next: DrawingStroke[]): void => {
      strokesRef.current = next;
      localIdsRef.current = new Set(next.map((stroke) => stroke.id));
      const canvas = canvasRef.current;
      if (canvas) redrawAll(canvas, next, null);
      onChange({
        strokes: next,
        flattenedImage: null,
        size: {
          width: canvas ? canvas.clientWidth : 0,
          height: canvas ? canvas.clientHeight : 0,
        },
      });
      setHistoryVersion((v) => v + 1);
    },
    [onChange],
  );

  const pushGesture = useCallback(
    (before: DrawingStroke[], after: DrawingStroke[]): void => {
      undoStackRef.current.push(before);
      if (undoStackRef.current.length > 60) undoStackRef.current.shift();
      redoStackRef.current = [];
      commitStrokes(after);
    },
    [commitStrokes],
  );

  const undo = useCallback((): void => {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    redoStackRef.current.push(strokesRef.current);
    commitStrokes(previous);
  }, [commitStrokes]);

  const redo = useCallback((): void => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(strokesRef.current);
    commitStrokes(next);
  }, [commitStrokes]);

  const clearAll = useCallback((): void => {
    if (strokesRef.current.length === 0) return;
    pushGesture(strokesRef.current, []);
  }, [pushGesture]);

  /*
   * Eraser drags accumulate into a single gesture: the "before" snapshot is
   * captured on pointer-down and only pushed to the undo stack once, at
   * pointer-up, so one Ctrl+Z restores everything removed by the drag.
   */
  const eraseGestureRef = useRef<{ before: DrawingStroke[] } | null>(null);

  const handleEraseDown = useCallback(
    (point: { x: number; y: number }): void => {
      const before = strokesRef.current;
      const remaining = before.filter((stroke) => !strokeHitTest(stroke, point));
      if (remaining.length === before.length) return;
      eraseGestureRef.current = { before };
      commitStrokes(remaining);
    },
    [commitStrokes],
  );

  const handleEraseMove = useCallback(
    (point: { x: number; y: number }): void => {
      if (!eraseGestureRef.current) return;
      const before = strokesRef.current;
      const remaining = before.filter((stroke) => !strokeHitTest(stroke, point));
      if (remaining.length !== before.length) commitStrokes(remaining);
    },
    [commitStrokes],
  );

  const finalizeEraseGesture = useCallback((): void => {
    const gesture = eraseGestureRef.current;
    eraseGestureRef.current = null;
    if (!gesture) return;
    undoStackRef.current.push(gesture.before);
    if (undoStackRef.current.length > 60) undoStackRef.current.shift();
    redoStackRef.current = [];
    setHistoryVersion((v) => v + 1);
  }, []);

  useImperativeHandle(
    handleRef,
    () => ({
      undo,
      redo,
      clearAll,
      canUndo: undoStackRef.current.length > 0,
      canRedo: redoStackRef.current.length > 0,
    }),
    [undo, redo, clearAll, historyVersion],
  );

  /* ------------------------- Pointer capture -------------------------- */

  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      if (!enabled) return;
      event.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.setPointerCapture(event.pointerId);
      drawingPointerRef.current = event.pointerId;
      const point = pointFromEvent(event);

      if (tool === 'eraser') {
        handleEraseDown(point);
        return;
      }

      liveStrokeRef.current = {
        id: makeStrokeId(),
        points: [point],
        color,
        width: TOOL_WIDTHS[tool] * (size / TOOL_WIDTHS.pen),
        opacity: tool === 'highlighter' ? HIGHLIGHTER_ALPHA : 1,
        tool,
      };
      redrawAll(canvas, strokesRef.current, liveStrokeRef.current);
    },
    [color, enabled, handleEraseDown, size, tool],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      if (!enabled || drawingPointerRef.current !== event.pointerId) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const point = pointFromEvent(event);

      if (tool === 'eraser') {
        handleEraseMove(point);
        return;
      }

      const live = liveStrokeRef.current;
      if (!live) return;
      // Coalesced events preserve fidelity for fast stylus movement.
      const nativeEvents =
        typeof event.nativeEvent.getCoalescedEvents === 'function'
          ? event.nativeEvent.getCoalescedEvents()
          : [];
      const rect = canvas.getBoundingClientRect();
      if (nativeEvents.length > 0) {
        for (const native of nativeEvents) {
          live.points.push({ x: native.clientX - rect.left, y: native.clientY - rect.top });
        }
      } else {
        const last = live.points[live.points.length - 1];
        if (Math.hypot(point.x - last.x, point.y - last.y) > 1) live.points.push(point);
      }
      redrawAll(canvas, strokesRef.current, live);
    },
    [enabled, handleEraseMove, tool],
  );

  const finishStroke = useCallback((): void => {
    const live = liveStrokeRef.current;
    liveStrokeRef.current = null;
    drawingPointerRef.current = null;
    if (!live) return;
    if (live.points.length === 0) return;
    pushGesture(strokesRef.current, [...strokesRef.current, live]);
  }, [pushGesture]);

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      if (drawingPointerRef.current !== event.pointerId) return;
      const canvas = canvasRef.current;
      if (canvas && canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      if (tool === 'eraser') {
        finalizeEraseGesture();
        drawingPointerRef.current = null;
        return;
      }
      finishStroke();
    },
    [finalizeEraseGesture, finishStroke, tool],
  );

  const cursor = enabled ? (tool === 'eraser' ? 'cell' : 'crosshair') : 'default';

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <canvas
        ref={canvasRef}
        aria-label="Drawing layer"
        className={`absolute left-0 top-0 ${enabled ? 'pointer-events-auto' : 'pointer-events-none'}`}
        style={{ touchAction: 'none', cursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={(event) => {
          if (drawingPointerRef.current === event.pointerId) finishStroke();
        }}
      />
    </div>
  );
}
