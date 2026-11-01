/**
 * App.tsx
 * ---------------------------------------------------------------------------
 * Root application shell for the OneNote Clone (Phases 1–3).
 *
 * Layout contract:
 *   ┌───────────────────────────────────────────────────────────────┐
 *   │ Header (#681498): brand · search · export · save status      │
 *   ├────────────┬──────────────┬───────────────────────────────────┤
 *   │ Notebooks  │ Sections +   │ Page canvas (title, body,         │
 *   │ rail       │ page list    │ tags, background styles)          │
 *   │            │ + tag filter │                                   │
 *   ├────────────┴──────────────┴───────────────────────────────────┤
 *   │ Status bar: breadcrumb · word/char/line stats · save time     │
 *   └───────────────────────────────────────────────────────────────┘
 *
 * Phase 3 additions:
 *   • Global instant SearchModal (Ctrl+F / ⌘F or clicking the search bar).
 *   • Tag Manager panel + colored tag chips + sidebar tag filtering.
 *   • Export menu (Markdown / Plain text / HTML / JSON backup).
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { useNotes } from './useNotes';
import type { NoteSearchResult, UseNotesResult } from './useNotes';
import type { BackgroundStyle, DrawingData, Note, Notebook, Section, TagDefinition } from './types';
import { DEFAULT_TAGS } from './types';
import RichTextEditor from './RichTextEditor';
import DrawingCanvas from './DrawingCanvas';
import type { DrawingCanvasHandle, DrawingToolbarState, InkTool } from './DrawingCanvas';
import { normalizeDrawings } from './DrawingCanvas';
import SearchModal from './SearchModal';
import ExportMenu from './ExportMenu';
import { TagChip, TagManagerPanel } from './TagManager';
import { INK_COLORS, htmlToPlainText } from './richText';

/** Minimal stroke model for the quick-draw overlay on the page list. */
interface QuickStroke {
  id: string;
  points: Array<{ x: number; y: number }>;
  color: string;
  width: number;
}

/** Resolves a tag label to its registry entry so chips can show its color. */
type TagLookup = (name: string) => TagDefinition | undefined;

/** Normalizes user text into a valid single tag label ('' when unusable). */
function sanitizeTagInput(raw: string): string {
  return raw.trim().replace(/\s*,\s*/g, ' ').replace(/[#@]/g, '').slice(0, 32);
}

/* ==========================================================================
 * Constants & tiny utilities
 * ======================================================================== */

const ONENOTE_PURPLE = '#681498';

const BACKGROUND_STYLES: ReadonlyArray<{ value: BackgroundStyle; label: string }> = [
  { value: 'plain', label: 'Plain' },
  { value: 'lined', label: 'Lined' },
  { value: 'grid', label: 'Grid' },
];

function formatRelativeTime(timestamp: number | null): string {
  if (!timestamp) return 'Never saved';
  const deltaSeconds = Math.round((Date.now() - timestamp) / 1000);
  if (deltaSeconds < 5) return 'Saved just now';
  if (deltaSeconds < 60) return `Saved ${deltaSeconds}s ago`;
  const minutes = Math.round(deltaSeconds / 60);
  if (minutes < 60) return `Saved ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Saved ${hours}h ago`;
  return `Saved on ${new Date(timestamp).toLocaleDateString()}`;
}

function pagePreview(note: Note): string {
  const flat = htmlToPlainText(note.content).replace(/\s+/g, ' ').trim();
  return flat.length === 0 ? 'Empty page' : flat.slice(0, 80);
}

const INK_TOOL_LABELS: Readonly<Record<InkTool, string>> = {
  pen: 'Pen',
  pencil: 'Pencil',
  highlighter: 'Highlighter',
  eraser: 'Eraser',
};

function makeQuickStrokeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `qs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ==========================================================================
 * Quick-draw overlay — lightweight SVG ink for the page-list column
 * (complements the full DrawingCanvas on the paper surface)
 * ======================================================================== */

interface QuickDrawOverlayProps {
  strokes: QuickStroke[];
  color: string;
  width: number;
  enabled: boolean;
  onStrokesChange: (strokes: QuickStroke[]) => void;
}

function QuickDrawOverlay({ strokes, color, width, enabled, onStrokesChange }: QuickDrawOverlayProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const liveStrokeRef = useRef<QuickStroke | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const [liveRenderTick, setLiveRenderTick] = useState(0);

  const pointFromEvent = (event: React.PointerEvent<SVGSVGElement>): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (!enabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerRef.current = event.pointerId;
    liveStrokeRef.current = { id: makeQuickStrokeId(), points: [pointFromEvent(event)], color, width };
    setLiveRenderTick((t) => t + 1);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (!enabled || activePointerRef.current !== event.pointerId) return;
    const live = liveStrokeRef.current;
    if (!live) return;
    live.points.push(pointFromEvent(event));
    setLiveRenderTick((t) => t + 1);
  };

  const finishStroke = (): void => {
    const live = liveStrokeRef.current;
    liveStrokeRef.current = null;
    activePointerRef.current = null;
    if (live && live.points.length > 1) onStrokesChange([...strokes, live]);
    setLiveRenderTick((t) => t + 1);
  };

  const renderable: QuickStroke[] =
    liveRenderTick >= 0 && liveStrokeRef.current ? [...strokes, liveStrokeRef.current] : strokes;

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 h-full w-full"
      style={{ pointerEvents: enabled ? 'auto' : 'none', touchAction: 'none', cursor: enabled ? 'crosshair' : 'default' }}
      aria-label="Quick draw layer"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishStroke}
      onPointerCancel={finishStroke}
    >
      {renderable.map((stroke) => (
        <polyline
          key={stroke.id}
          fill="none"
          stroke={stroke.color}
          strokeWidth={stroke.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          points={stroke.points.map((p) => `${p.x},${p.y}`).join(' ')}
        />
      ))}
    </svg>
  );
}

/* ==========================================================================
 * Inline SVG icon set (no external icon dependency in Phase 1)
 * ======================================================================== */

interface IconProps {
  size?: number;
  className?: string;
}

function NotebookIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M4 4.5A1.5 1.5 0 0 1 5.5 3H18a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5.5A1.5 1.5 0 0 1 4 19.5v-15Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M8 3v18" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function SectionIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 9h16" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function PageIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M6 3h8l4 4v14H6V3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M14 3v4h4M9 12h6M9 16h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PinIcon({ size = 14, className, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M14.5 3 21 9.5l-3.2 1.2-2.3 5.3-3.5-3.5-5.5 5.5 5.5-5.5L8 9l5.3-2.3L14.5 3Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M5 7h14M10 7V5h4v2m-8 0 1 13h8l1-13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TagIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M4 4h7.5L20 12.5 12.5 20 4 11.5V4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="8.25" cy="8.25" r="1.35" fill="currentColor" />
    </svg>
  );
}

/* ==========================================================================
 * Header bar
 * ======================================================================== */

interface HeaderBarProps {
  onOpenSearch: () => void;
  isSaving: boolean;
  lastSavedAt: number | null;
  onNewPage: () => void;
  onNewSection: () => void;
  onNewNotebook: () => void;
  disabled: boolean;
  exportMenu: ReactNode;
  onOpenTagManager: () => void;
}

function HeaderBar({
  onOpenSearch,
  isSaving,
  lastSavedAt,
  onNewPage,
  onNewSection,
  onNewNotebook,
  disabled,
  exportMenu,
  onOpenTagManager,
}: HeaderBarProps) {
  return (
    <header
      className="flex h-12 shrink-0 items-center gap-4 px-4 text-white shadow-md"
      style={{ backgroundColor: ONENOTE_PURPLE }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2 select-none">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-md bg-white/15 text-sm font-bold tracking-tight"
          aria-hidden="true"
        >
          N
        </span>
        <h1 className="text-[15px] font-semibold tracking-wide">OneNote</h1>
      </div>

      {/* Search trigger — clicking opens the global instant-search modal. */}
      <div className="relative mx-auto w-full max-w-xl">
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Open search (Ctrl+F)"
          className="flex h-8 w-full items-center gap-2 rounded-md border border-white/20 bg-white/10 px-3 text-left text-sm text-white/70 outline-none transition hover:bg-white/15 focus:border-white/50 focus:bg-white/15"
        >
          <SearchIcon />
          <span className="flex-1 truncate">Search notes, tags, content…</span>
          <kbd className="hidden rounded border border-white/30 bg-white/10 px-1.5 py-px text-[10px] font-medium text-white/80 sm:block">
            Ctrl F
          </kbd>
        </button>
      </div>

      {/* Save status */}
      <div className="hidden items-center gap-1.5 text-xs text-white/80 md:flex" role="status" aria-live="polite">
        <span
          className={`h-2 w-2 rounded-full ${isSaving ? 'animate-pulse bg-amber-300' : 'bg-emerald-400'}`}
        />
        {isSaving ? 'Saving…' : formatRelativeTime(lastSavedAt)}
      </div>

      {/* Export ribbon (File · Review): Markdown / Plain text / HTML / JSON backup */}
      {exportMenu}

      {/* Tag manager trigger */}
      <button
        type="button"
        onClick={onOpenTagManager}
        aria-label="Open tag manager"
        title="Manage color-coded tags"
        className="flex h-8 items-center gap-1.5 rounded-md border border-white/25 px-2.5 text-xs font-medium text-white transition hover:bg-white/10"
      >
        <TagIcon size={14} />
        <span className="hidden xl:inline">Tags</span>
      </button>

      {/* Primary actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onNewNotebook}
          disabled={disabled}
          className="hidden h-8 items-center gap-1.5 rounded-md border border-white/25 px-3 text-xs font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 lg:flex"
        >
          <NotebookIcon size={14} /> New Notebook
        </button>
        <button
          type="button"
          onClick={onNewSection}
          disabled={disabled}
          className="hidden h-8 items-center gap-1.5 rounded-md border border-white/25 px-3 text-xs font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 lg:flex"
        >
          <SectionIcon size={14} /> New Section
        </button>
        <button
          type="button"
          onClick={onNewPage}
          disabled={disabled}
          className="flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-xs font-semibold transition hover:bg-white/85 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ color: ONENOTE_PURPLE }}
        >
          <PlusIcon size={14} /> New Page
        </button>
      </div>
    </header>
  );
}

/* ==========================================================================
 * Column 1 — Notebook rail
 * ========================================================================== */

interface NotebookRailProps {
  notebooks: Notebook[];
  activeNotebookId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

function NotebookRail({ notebooks, activeNotebookId, onSelect, onRename, onDelete }: NotebookRailProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const commitRename = useCallback(() => {
    if (editingId && draft.trim()) onRename(editingId, draft);
    setEditingId(null);
  }, [draft, editingId, onRename]);

  return (
    <nav
      aria-label="Notebooks"
      className="flex w-48 shrink-0 flex-col border-r border-black/10 bg-[#efeae7]"
    >
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Notebooks
        </span>
      </div>
      <ul className="flex-1 overflow-y-auto px-2 pb-2">
        {notebooks.map((nb) => {
          const isActive = nb.id === activeNotebookId;
          return (
            <li key={nb.id} className="group mt-0.5">
              {editingId === nb.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="h-8 w-full rounded border border-purple-400 bg-white px-2 text-sm outline-none"
                  aria-label="Rename notebook"
                />
              ) : (
                <div
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition ${
                    isActive
                      ? 'bg-white font-semibold text-neutral-900 shadow-panel'
                      : 'text-neutral-700 hover:bg-white/60'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(nb.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <NotebookIcon size={15} className="shrink-0" />
                    <span className="truncate">{nb.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(nb.id);
                      setDraft(nb.name);
                    }}
                    title="Rename notebook"
                    aria-label={`Rename notebook ${nb.name}`}
                    className="hidden h-5 w-5 shrink-0 rounded text-[10px] leading-none text-neutral-500 hover:bg-neutral-200 group-hover:block"
                  >
                    ✎
                  </button>
                  {notebooks.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onDelete(nb.id)}
                      title="Delete notebook"
                      aria-label={`Delete notebook ${nb.name}`}
                      className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-red-100 hover:text-red-600 group-hover:flex"
                    >
                      <TrashIcon size={13} />
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* ==========================================================================
 * Column 2 — Sections + page list
 * ========================================================================== */

interface SectionListProps {
  sections: Section[];
  activeSectionId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

function SectionColumn({ sections, activeSectionId, onSelect, onRename, onDelete }: SectionListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const commitRename = useCallback(() => {
    if (editingId && draft.trim()) onRename(editingId, draft);
    setEditingId(null);
  }, [draft, editingId, onRename]);

  return (
    <div className="border-b border-black/10 bg-[#e6dfd9]">
      <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        Sections
      </div>
      <ul className="max-h-44 overflow-y-auto px-2 pb-2">
        {sections.length === 0 && (
          <li className="px-2 py-2 text-xs italic text-neutral-500">No sections yet.</li>
        )}
        {sections.map((section) => {
          const isActive = section.id === activeSectionId;
          return (
            <li key={section.id} className="group mt-0.5">
              {editingId === section.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="h-8 w-full rounded border border-purple-400 bg-white px-2 text-sm outline-none"
                  aria-label="Rename section"
                />
              ) : (
                <div
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition ${
                    isActive
                      ? 'bg-white font-semibold text-neutral-900 shadow-panel'
                      : 'text-neutral-700 hover:bg-white/60'
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: section.color }}
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    onClick={() => onSelect(section.id)}
                    className="min-w-0 flex-1 truncate text-left"
                    aria-current={isActive ? 'page' : undefined}
                  >
                    {section.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(section.id);
                      setDraft(section.name);
                    }}
                    title="Rename section"
                    aria-label={`Rename section ${section.name}`}
                    className="hidden h-5 w-5 shrink-0 rounded text-[10px] leading-none text-neutral-500 hover:bg-neutral-200 group-hover:block"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(section.id)}
                    title="Delete section"
                    aria-label={`Delete section ${section.name}`}
                    className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-red-100 hover:text-red-600 group-hover:flex"
                  >
                    <TrashIcon size={13} />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface PageListProps {
  pages: Note[];
  activePageId: string | null;
  onSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
  /** Registry lookup so each chip can render its assigned color. */
  findTagByName: TagLookup;
  /** Currently active sidebar tag filter (null = show everything). */
  selectedTagFilter: string | null;
  /** Clicking a chip in the list toggles that tag as the filter. */
  onFilterByTag: (tag: string) => void;
}

function PageColumn({
  pages,
  activePageId,
  onSelect,
  onTogglePin,
  onDelete,
  findTagByName,
  selectedTagFilter,
  onFilterByTag,
}: PageListProps) {
  const [quickDrawEnabled, setQuickDrawEnabled] = useState(false);
  const [quickStrokes, setQuickStrokes] = useState<QuickStroke[]>([]);
  const [quickColor, setQuickColor] = useState<string>(INK_COLORS[0] ?? '#681498');

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f7f4f2]">
      <div className="flex items-center gap-2 px-3 pb-1 pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Pages</span>
        <button
          type="button"
          onClick={() => setQuickDrawEnabled((v) => !v)}
          aria-pressed={quickDrawEnabled}
          title="Sketch a quick note over the page list"
          className={`ml-auto rounded border px-1.5 py-0.5 text-[10px] font-medium transition ${
            quickDrawEnabled
              ? 'border-[#681498] bg-[#681498] text-white'
              : 'border-neutral-300 bg-white text-neutral-600 hover:border-purple-400 hover:text-[#681498]'
          }`}
        >
          ✎ Quick draw
        </button>
        {quickDrawEnabled && (
          <>
            <label className="flex items-center gap-1 text-[10px] text-neutral-500">
              Ink
              <select
                value={quickColor}
                onChange={(e) => setQuickColor(e.target.value)}
                aria-label="Quick draw ink color"
                className="h-5 rounded border border-neutral-300 bg-white px-1 text-[10px]"
              >
                {INK_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setQuickStrokes([])}
              className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-[10px] text-neutral-600 hover:border-red-300 hover:text-red-600"
            >
              Clear
            </button>
          </>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        <ul className="h-full overflow-y-auto px-2 pb-2">
        {pages.length === 0 && (
          <li className="px-2 py-2 text-xs italic text-neutral-500">
            This section has no pages. Click “New Page” to add one.
          </li>
        )}
        {pages.map((page) => {
          const isActive = page.id === activePageId;
          return (
            <li key={page.id} className="group mt-1">
              <div
                className={`rounded-md border-l-4 px-2 py-1.5 transition ${
                  isActive
                    ? 'border-l-[#681498] bg-white shadow-panel'
                    : 'border-l-transparent hover:bg-white/70'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onSelect(page.id)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <PageIcon size={14} className="shrink-0 text-neutral-500" />
                    <span className={`truncate text-sm ${isActive ? 'font-semibold text-neutral-900' : 'text-neutral-700'}`}>
                      {page.title}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onTogglePin(page.id)}
                    title={page.pinned ? 'Unpin page' : 'Pin page'}
                    aria-label={page.pinned ? `Unpin ${page.title}` : `Pin ${page.title}`}
                    className={`shrink-0 rounded p-0.5 transition hover:bg-neutral-100 ${
                      page.pinned ? 'text-[#681498]' : 'text-neutral-400 opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <PinIcon size={13} filled={page.pinned} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(page.id)}
                    title="Delete page"
                    aria-label={`Delete ${page.title}`}
                    className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-red-100 hover:text-red-600 group-hover:flex"
                  >
                    <TrashIcon size={13} />
                  </button>
                </div>
                <p className="mt-0.5 truncate pl-5 text-xs text-neutral-500">{pagePreview(page)}</p>
                {page.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1 pl-5">
                    {page.tags.map((tag) => (
                      <TagChip
                        key={tag}
                        definition={findTagByName(tag)}
                        name={tag}
                        size="sm"
                        active={selectedTagFilter === tag}
                        onClick={() => onFilterByTag(tag)}
                        title={`Filter pages by “${tag}”`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
        </ul>
        {quickDrawEnabled && (
          <QuickDrawOverlay
            strokes={quickStrokes}
            color={quickColor}
            width={2.5}
            enabled={quickDrawEnabled}
            onStrokesChange={setQuickStrokes}
          />
        )}
      </div>
    </div>
  );
}

/* ==========================================================================
 * Column 3 — Page editor canvas
 * ========================================================================== */

interface PageCanvasProps {
  note: Note | null;
  sectionName: string;
  onTitleChange: (title: string) => void;
  onContentChange: (content: string) => void;
  onBackgroundChange: (style: BackgroundStyle) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onDrawingsChange: (drawings: DrawingData) => void;
  /** Registry lookup so page chips render their assigned colors. */
  findTagByName: TagLookup;
  /** Full tag registry, used to populate the quick-add suggestions list. */
  tags: TagDefinition[];
}

function backgroundStyleFor(style: BackgroundStyle): CSSProperties {
  switch (style) {
    case 'lined':
      return {
        backgroundImage:
          'repeating-linear-gradient(to bottom, transparent 0px, transparent 30px, #dbeafe 30px, #dbeafe 31px)',
        lineHeight: '31px',
      };
    case 'grid':
      return {
        backgroundImage:
          'repeating-linear-gradient(to bottom, transparent 0px, transparent 27px, #e5e7eb 27px, #e5e7eb 28px),' +
          'repeating-linear-gradient(to right, transparent 0px, transparent 27px, #e5e7eb 27px, #e5e7eb 28px)',
        lineHeight: '28px',
      };
    case 'plain':
    default:
      return {};
  }
}

function PageCanvas({
  note,
  sectionName,
  onTitleChange,
  onContentChange,
  onBackgroundChange,
  onAddTag,
  onRemoveTag,
  onDrawingsChange,
  findTagByName,
  tags,
}: PageCanvasProps) {
  const [tagInput, setTagInput] = useState('');
  const [drawMode, setDrawMode] = useState(false);
  const [inkTool, setInkTool] = useState<InkTool>('pen');
  const [inkColor, setInkColor] = useState<string>(INK_COLORS[0] ?? '#681498');
  const [inkSize, setInkSize] = useState(1);
  const canvasHandleRef = useRef<DrawingCanvasHandle | null>(null);

  useEffect(() => {
    if (drawMode) setTagInput('');
  }, [drawMode]);

  const drawingToolbar: DrawingToolbarState = useMemo(
    () => ({ tool: inkTool, color: inkColor, size: inkSize }),
    [inkTool, inkColor, inkSize],
  );

  const strokeCount = useMemo(() => normalizeDrawings(note?.drawings ?? '').strokes.length, [note?.drawings]);

  const submitTag = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const value = sanitizeTagInput(tagInput);
      if (value && note) onAddTag(value);
      setTagInput('');
    },
    [note, onAddTag, tagInput],
  );

  if (!note) {
    return (
      <main className="flex min-w-0 flex-1 items-center justify-center bg-[#f3f2f1] p-8">
        <div className="max-w-sm rounded-lg border border-dashed border-neutral-300 bg-white/70 p-8 text-center shadow-panel">
          <div
            className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full text-white"
            style={{ backgroundColor: ONENOTE_PURPLE }}
            aria-hidden="true"
          >
            <PageIcon size={22} />
          </div>
          <h2 className="text-base font-semibold text-neutral-800">No page selected</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Pick a page from the list, or create a new one with the “New Page” button above.
          </p>
        </div>
      </main>
    );
  }

  const availableSuggestions = useMemo(() => {
    const used = new Set((note?.tags ?? []).map((t) => t.toLowerCase()));
    const registry: Array<{ name: string; color: string }> = tags
      .filter((tag) => !used.has(tag.name.toLowerCase()))
      .map((tag) => ({ name: tag.name, color: tag.color }));
    const seeds = DEFAULT_TAGS.filter((name) => !used.has(name.toLowerCase())).map((name) => ({
      name,
      color: ONENOTE_PURPLE,
    }));
    return [...registry, ...seeds].slice(0, 6);
  }, [note?.tags, tags]);

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-[#f3f2f1]">
      {/* Page toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-black/10 bg-white px-4">
        <span className="truncate text-xs font-medium text-neutral-500">{sectionName}</span>
        <span className="h-4 w-px bg-neutral-200" aria-hidden="true" />
        <label className="flex items-center gap-1.5 text-xs text-neutral-600">
          Background
          <select
            value={note.backgroundStyle}
            onChange={(e) => onBackgroundChange(e.target.value as BackgroundStyle)}
            className="h-7 rounded border border-neutral-300 bg-white px-1.5 text-xs outline-none focus:border-purple-500"
            aria-label="Page background style"
          >
            {BACKGROUND_STYLES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <span className="h-4 w-px bg-neutral-200" aria-hidden="true" />
        <button
          type="button"
          onClick={() => setDrawMode((v) => !v)}
          aria-pressed={drawMode}
          className={`flex h-7 items-center gap-1 rounded border px-2 text-xs font-medium transition ${
            drawMode
              ? 'border-[#681498] bg-[#681498] text-white'
              : 'border-neutral-300 bg-white text-neutral-600 hover:border-purple-400 hover:text-[#681498]'
          }`}
        >
          ✎ Draw
        </button>
        {strokeCount > 0 && (
          <span className="text-[11px] text-neutral-400">{strokeCount} ink stroke{strokeCount === 1 ? '' : 's'}</span>
        )}
        <span className="ml-auto text-[11px] text-neutral-400">
          Edited {new Date(note.updatedAt).toLocaleString()}
        </span>
      </div>

      {/* Drawing ribbon — visible while the Draw tab is active */}
      {drawMode && (
        <div className="flex h-9 shrink-0 flex-wrap items-center gap-2 border-b border-black/10 bg-[#faf9f8] px-4">
          {(Object.keys(INK_TOOL_LABELS) as InkTool[]).map((toolName) => (
            <button
              key={toolName}
              type="button"
              onClick={() => setInkTool(toolName)}
              aria-pressed={inkTool === toolName}
              className={`h-6 rounded px-2 text-xs capitalize transition ${
                inkTool === toolName
                  ? 'bg-[#681498] font-semibold text-white'
                  : 'bg-white text-neutral-600 ring-1 ring-neutral-300 hover:ring-purple-400'
              }`}
            >
              {INK_TOOL_LABELS[toolName]}
            </button>
          ))}
          <span className="h-4 w-px bg-neutral-200" aria-hidden="true" />
          <span className="flex items-center gap-1">
            {INK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setInkColor(c)}
                aria-label={`Ink color ${c}`}
                aria-pressed={inkColor === c}
                className={`h-5 w-5 rounded-full border-2 transition ${
                  inkColor === c ? 'scale-110 border-neutral-800' : 'border-white ring-1 ring-neutral-300'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </span>
          <span className="h-4 w-px bg-neutral-200" aria-hidden="true" />
          <label className="flex items-center gap-1 text-xs text-neutral-600">
            Size
            <input
              type="range"
              min={0.5}
              max={3}
              step={0.25}
              value={inkSize}
              onChange={(e) => setInkSize(Number(e.target.value))}
              aria-label="Ink size"
              className="w-20 accent-[#681498]"
            />
          </label>
          <span className="h-4 w-px bg-neutral-200" aria-hidden="true" />
          <button
            type="button"
            onClick={() => canvasHandleRef.current?.undo()}
            className="h-6 rounded bg-white px-2 text-xs text-neutral-600 ring-1 ring-neutral-300 hover:ring-purple-400"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={() => canvasHandleRef.current?.redo()}
            className="h-6 rounded bg-white px-2 text-xs text-neutral-600 ring-1 ring-neutral-300 hover:ring-purple-400"
          >
            Redo
          </button>
          <button
            type="button"
            onClick={() => canvasHandleRef.current?.clearAll()}
            className="h-6 rounded bg-white px-2 text-xs text-red-600 ring-1 ring-red-200 hover:ring-red-400"
          >
            Clear ink
          </button>
        </div>
      )}

      {/* Paper surface */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="relative mx-auto flex min-h-full w-full max-w-4xl flex-col rounded-sm bg-white shadow-panel ring-1 ring-black/5">
          <input
            value={note.title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Page title"
            aria-label="Page title"
            className="w-full border-b border-neutral-100 px-8 pb-2 pt-6 text-2xl font-semibold text-neutral-900 outline-none placeholder:text-neutral-300"
          />

          {/* Tag row — colored registry chips + quick add */}
          <div className="flex flex-wrap items-center gap-1.5 px-8 pb-2 pt-3">
            {note.tags.map((tag) => (
              <TagChip
                key={tag}
                definition={findTagByName(tag)}
                name={tag}
                onRemove={() => onRemoveTag(tag)}
                title={`${tag} — click × to remove`}
              />
            ))}
            <form onSubmit={submitTag} className="inline-flex items-center">
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                list="tag-suggestions"
                placeholder="+ Add tag"
                aria-label="Add tag"
                className="h-6 w-24 rounded-full border border-dashed border-neutral-300 px-2 text-xs outline-none focus:border-purple-400"
              />
              <datalist id="tag-suggestions">
                {availableSuggestions.map((t) => (
                  <option key={t.name} value={t.name} />
                ))}
              </datalist>
            </form>
          </div>

          {/* Body — Phase 2 rich-text editor replaces the legacy textarea */}
          <RichTextEditor
            noteId={note.id}
            html={note.content}
            onChange={onContentChange}
            paperStyle={backgroundStyleFor(note.backgroundStyle)}
            placeholder="Start typing your notes…"
          />

          {/* Phase 2 freehand ink layer, aligned to the paper surface */}
          <DrawingCanvas
            value={note.drawings}
            onChange={onDrawingsChange}
            enabled={drawMode}
            handleRef={canvasHandleRef}
            toolbar={drawingToolbar}
          />
        </div>
      </div>
    </main>
  );
}

/* ==========================================================================
 * Status bar
 * ========================================================================== */

interface StatusBarProps {
  breadcrumb: string;
  stats: UseNotesResult['stats'];
  isSaving: boolean;
  lastSavedAt: number | null;
}

function StatusBar({ breadcrumb, stats, isSaving, lastSavedAt }: StatusBarProps) {
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-black/10 bg-white px-4 text-[11px] text-neutral-500">
      <span className="truncate font-medium text-neutral-600">{breadcrumb}</span>
      <span className="ml-auto flex items-center gap-4 tabular-nums">
        <span>{stats.wordCount.toLocaleString()} words</span>
        <span>{stats.characterCount.toLocaleString()} chars</span>
        <span>{stats.lineCount.toLocaleString()} lines</span>
        <span>{stats.readingTimeMinutes} min read</span>
        <span className={isSaving ? 'text-amber-600' : 'text-emerald-600'}>
          {isSaving ? 'Saving…' : formatRelativeTime(lastSavedAt)}
        </span>
      </span>
    </footer>
  );
}

/* ==========================================================================
 * Tag filter strip — sidebar row of color-coded chips (click to filter)
 * ======================================================================== */

interface TagFilterStripProps {
  tags: TagDefinition[];
  usageCounts: ReadonlyMap<string, number>;
  selectedTagFilter: string | null;
  onToggleFilter: (tag: string) => void;
  onOpenManager: () => void;
}

function TagFilterStrip({
  tags,
  usageCounts,
  selectedTagFilter,
  onToggleFilter,
  onOpenManager,
}: TagFilterStripProps) {
  const visible = useMemo(
    () =>
      tags
        .map((tag) => ({ tag, count: usageCounts.get(tag.name.toLowerCase()) ?? 0 }))
        .filter((entry) => entry.count > 0 || entry.tag.name === selectedTagFilter)
        .sort((a, b) => b.count - a.count || a.tag.name.localeCompare(b.tag.name)),
    [selectedTagFilter, tags, usageCounts],
  );

  return (
    <div className="shrink-0 border-t border-black/10 bg-[#f7f4f2] px-3 py-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Tags</span>
        <button
          type="button"
          onClick={onOpenManager}
          className="rounded px-1 text-[11px] font-medium text-[#681498] hover:bg-purple-50"
        >
          Manage…
        </button>
      </div>
      {visible.length === 0 ? (
        <p className="pb-1 text-[11px] italic text-neutral-500">No tagged pages yet.</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {visible.map(({ tag, count }) => (
            <TagChip
              key={tag.id}
              definition={tag}
              name={tag.name}
              size="sm"
              active={selectedTagFilter === tag.name}
              onClick={() => onToggleFilter(tag.name)}
              title={`${count} page${count === 1 ? '' : 's'} · click to ${
                selectedTagFilter === tag.name ? 'clear filter' : 'filter'
              }`}
            />
          ))}
        </div>
      )}
      {selectedTagFilter && (
        <button
          type="button"
          onClick={() => onToggleFilter(selectedTagFilter)}
          className="mt-1.5 text-[11px] font-medium text-neutral-500 underline-offset-2 hover:text-[#681498] hover:underline"
        >
          Clear tag filter
        </button>
      )}
    </div>
  );
}

/* ==========================================================================
 * Toast host — transient confirmations for exports and destructive actions
 * ======================================================================== */

interface ToastItem {
  id: string;
  message: string;
}

function ToastStack({ toasts }: { toasts: ToastItem[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-10 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          className="animate-toast-in rounded-md border border-black/10 bg-white px-3 py-2 text-xs font-medium text-neutral-700 shadow-panel"
          style={{ borderLeftWidth: 4, borderLeftColor: ONENOTE_PURPLE }}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}

/* ==========================================================================
 * Root component
 * ======================================================================== */

export default function App() {
  const store = useNotes();
  const {
    notebooks,
    notes,
    activeNotebook,
    activeSection,
    activeNote,
    activeSections,
    activeSectionNotes,
    stats,
    isSaving,
    lastSavedAt,
    selectNotebook,
    selectSection,
    selectPage,
    createNotebook,
    renameNotebook,
    deleteNotebook,
    createSection,
    renameSection,
    deleteSection,
    createPage,
    updatePageContent,
    renamePage,
    deletePage,
    togglePin,
    addTag,
    removeTag,
    setBackgroundStyle,
    setDrawings,
    searchAllNotes,
    tags,
    createTag,
    renameTag,
    retagColor,
    deleteTag,
    findTagByName,
  } = store;

  /* ---------------- Phase 3 UI state ---------------- */
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isTagManagerOpen, setIsTagManagerOpen] = useState(false);
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeqRef = useRef(0);

  const pushToast = useCallback((message: string) => {
    const id = `t-${Date.now().toString(36)}-${(toastSeqRef.current += 1)}`;
    setToasts((current) => [...current.slice(-2), { id, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3200);
  }, []);

  /* Ctrl+F / ⌘F toggles the global instant-search modal anywhere in the app. */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'f') {
        event.preventDefault();
        setIsSearchOpen((open) => !open);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'k') {
        event.preventDefault();
        setIsSearchOpen(true);
        return;
      }
      if (event.key === 'Escape') {
        setIsSearchOpen(false);
        setIsTagManagerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  /* ---------------- Search wiring ---------------- */
  const openSearch = useCallback(() => setIsSearchOpen(true), []);
  const closeSearch = useCallback(() => setIsSearchOpen(false), []);

  const handleSearchSelect = useCallback(
    (result: NoteSearchResult) => {
      if (result.notebook) selectNotebook(result.notebook.id);
      if (result.section) selectSection(result.section.id);
      selectPage(result.note.id);
      setIsSearchOpen(false);
      pushToast(`Opened “${result.note.title}”`);
    },
    [pushToast, selectNotebook, selectPage, selectSection],
  );

  /* ---------------- Tag filtering ---------------- */
  const toggleTagFilter = useCallback((tag: string) => {
    setSelectedTagFilter((current) => (current === tag ? null : tag));
  }, []);

  const filteredPages = useMemo(() => {
    if (!selectedTagFilter) return activeSectionNotes;
    const needle = selectedTagFilter.toLowerCase();
    return activeSectionNotes.filter((page) => page.tags.some((tag) => tag.toLowerCase() === needle));
  }, [activeSectionNotes, selectedTagFilter]);

  const tagUsageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of notes) {
      for (const tag of note.tags) {
        const key = tag.toLowerCase();
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts as ReadonlyMap<string, number>;
  }, [notes]);

  const handleCreateTag = useCallback(
    (name: string, color: string) => {
      const created = createTag(name, color);
      pushToast(created ? `Tag “${created.name}” created` : 'Tag already exists');
    },
    [createTag, pushToast],
  );

  const handleRenameTag = useCallback(
    (tagId: string, name: string) => {
      const previous = tags.find((tag) => tag.id === tagId)?.name;
      renameTag(tagId, name);
      if (previous && selectedTagFilter === previous) {
        setSelectedTagFilter(name.trim());
      }
    },
    [renameTag, selectedTagFilter, tags],
  );

  const handleDeleteTag = useCallback(
    (tagId: string) => {
      const removed = tags.find((tag) => tag.id === tagId)?.name;
      deleteTag(tagId);
      if (removed && selectedTagFilter === removed) setSelectedTagFilter(null);
      if (removed) pushToast(`Tag “${removed}” deleted`);
    },
    [deleteTag, pushToast, selectedTagFilter, tags],
  );

  /* ---------------- Export wiring ---------------- */
  const handleExported = useCallback(
    (format: string, filename: string) => {
      const labels: Record<string, string> = {
        markdown: 'Markdown',
        text: 'Plain text',
        html: 'HTML',
        json: 'JSON backup',
      };
      pushToast(`Exported ${labels[format] ?? format} → ${filename}`);
    },
    [pushToast],
  );

  /* ---------------- Structural actions ---------------- */
  const handleNewPage = useCallback(() => {
    if (!activeSection) {
      createSection('New Section');
    }
    createPage();
  }, [activeSection, createPage, createSection]);

  const handleNewSection = useCallback(() => {
    createSection(`Section ${activeSections.length + 1}`);
  }, [activeSections.length, createSection]);

  const handleNewNotebook = useCallback(() => {
    createNotebook(`Notebook ${notebooks.length + 1}`);
  }, [createNotebook, notebooks.length]);

  const breadcrumb = useMemo(() => {
    const parts = [activeNotebook?.name, activeSection?.name, activeNote?.title].filter(Boolean);
    return parts.length > 0 ? parts.join('  ›  ') : 'OneNote Clone';
  }, [activeNote, activeNotebook, activeSection]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#f3f2f1] font-sans text-neutral-900">
      <HeaderBar
        onOpenSearch={openSearch}
        isSaving={isSaving}
        lastSavedAt={lastSavedAt}
        onNewPage={handleNewPage}
        onNewSection={handleNewSection}
        onNewNotebook={handleNewNotebook}
        disabled={!activeNotebook}
        onOpenTagManager={() => setIsTagManagerOpen(true)}
        exportMenu={
          <ExportMenu
            note={activeNote}
            sectionName={activeSection?.name ?? 'Unfiled'}
            notebookName={activeNotebook?.name ?? 'Notebook'}
            notebooks={notebooks}
            notes={notes}
            onExported={handleExported}
          />
        }
      />

      <div className="flex min-h-0 flex-1">
        <NotebookRail
          notebooks={notebooks}
          activeNotebookId={store.activeNotebookId}
          onSelect={selectNotebook}
          onRename={renameNotebook}
          onDelete={deleteNotebook}
        />

        <aside className="flex w-64 shrink-0 flex-col border-r border-black/10 bg-[#efeae7]">
          <SectionColumn
            sections={activeSections}
            activeSectionId={store.activeSectionId}
            onSelect={selectSection}
            onRename={renameSection}
            onDelete={deleteSection}
          />
          <PageColumn
            pages={filteredPages}
            activePageId={store.activePageId}
            onSelect={selectPage}
            onTogglePin={togglePin}
            onDelete={deletePage}
            findTagByName={findTagByName}
            selectedTagFilter={selectedTagFilter}
            onFilterByTag={toggleTagFilter}
          />
          <TagFilterStrip
            tags={tags}
            usageCounts={tagUsageCounts}
            selectedTagFilter={selectedTagFilter}
            onToggleFilter={toggleTagFilter}
            onOpenManager={() => setIsTagManagerOpen(true)}
          />
        </aside>

        <PageCanvas
          note={activeNote}
          sectionName={activeSection?.name ?? 'No section'}
          onTitleChange={(title) => {
            if (activeNote) renamePage(activeNote.id, title);
          }}
          onContentChange={(content) => {
            if (activeNote) updatePageContent(activeNote.id, content);
          }}
          onBackgroundChange={(style) => {
            if (activeNote) setBackgroundStyle(activeNote.id, style);
          }}
          onAddTag={(tag) => {
            if (!activeNote) return;
            addTag(activeNote.id, tag);
            /* Keep brand-new labels registered so chips get a color. */
            if (!findTagByName(tag)) createTag(tag);
          }}
          onRemoveTag={(tag) => {
            if (activeNote) removeTag(activeNote.id, tag);
          }}
          onDrawingsChange={(drawings) => {
            if (activeNote) setDrawings(activeNote.id, drawings);
          }}
          findTagByName={findTagByName}
          tags={tags}
        />
      </div>

      <StatusBar
        breadcrumb={breadcrumb}
        stats={stats}
        isSaving={isSaving}
        lastSavedAt={lastSavedAt}
      />

      {/* Phase 3 overlays */}
      <SearchModal
        open={isSearchOpen}
        onClose={closeSearch}
        searchAllNotes={searchAllNotes}
        onSelectResult={handleSearchSelect}
      />

      {isTagManagerOpen && (
        <div className="fixed inset-0 z-40 flex items-start justify-end bg-black/20 p-4 sm:p-6">
          <TagManagerPanel
            tags={tags}
            usageCounts={tagUsageCounts}
            onCreate={handleCreateTag}
            onRename={handleRenameTag}
            onRecolor={retagColor}
            onDelete={handleDeleteTag}
            onClose={() => setIsTagManagerOpen(false)}
          />
        </div>
      )}

      <ToastStack toasts={toasts} />
    </div>
  );
}
