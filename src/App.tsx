/**
 * App.tsx
 * ---------------------------------------------------------------------------
 * Root application shell for the OneNote Clone (Phase 1).
 *
 * Layout contract:
 *   ┌───────────────────────────────────────────────────────────────┐
 *   │ Header (#681498): brand · search · save status · new page     │
 *   ├────────────┬──────────────┬───────────────────────────────────┤
 *   │ Notebooks  │ Sections +   │ Page canvas (title, body,         │
 *   │ rail       │ page list    │ tags, background styles)          │
 *   ├────────────┴──────────────┴───────────────────────────────────┤
 *   │ Status bar: breadcrumb · word/char/line stats · save time     │
 *   └───────────────────────────────────────────────────────────────┘
 * ---------------------------------------------------------------------------
 */

import { useCallback, useMemo, useState } from 'react';
import type { ChangeEvent, CSSProperties, FormEvent } from 'react';
import { useNotes } from './useNotes';
import type { UseNotesResult } from './useNotes';
import type { BackgroundStyle, Note, Notebook, Section } from './types';
import { DEFAULT_TAGS } from './types';

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
  const flat = note.content.replace(/\s+/g, ' ').trim();
  return flat.length === 0 ? 'Empty page' : flat.slice(0, 80);
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

/* ==========================================================================
 * Header bar
 * ======================================================================== */

interface HeaderBarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  isSaving: boolean;
  lastSavedAt: number | null;
  onNewPage: () => void;
  onNewSection: () => void;
  onNewNotebook: () => void;
  disabled: boolean;
}

function HeaderBar({
  searchQuery,
  onSearchChange,
  isSaving,
  lastSavedAt,
  onNewPage,
  onNewSection,
  onNewNotebook,
  disabled,
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

      {/* Search */}
      <div className="relative mx-auto w-full max-w-xl">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/70">
          <SearchIcon />
        </span>
        <input
          type="search"
          value={searchQuery}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onSearchChange(e.target.value)}
          placeholder="Search notes, tags, content…"
          aria-label="Search notes"
          className="h-8 w-full rounded-md border border-white/20 bg-white/10 pl-9 pr-3 text-sm text-white placeholder-white/60 outline-none transition focus:border-white/50 focus:bg-white/15"
        />
      </div>

      {/* Save status */}
      <div className="hidden items-center gap-1.5 text-xs text-white/80 md:flex" role="status" aria-live="polite">
        <span
          className={`h-2 w-2 rounded-full ${isSaving ? 'animate-pulse bg-amber-300' : 'bg-emerald-400'}`}
        />
        {isSaving ? 'Saving…' : formatRelativeTime(lastSavedAt)}
      </div>

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
}

function PageColumn({ pages, activePageId, onSelect, onTogglePin, onDelete }: PageListProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f7f4f2]">
      <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        Pages
      </div>
      <ul className="flex-1 overflow-y-auto px-2 pb-2">
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
                      <span
                        key={tag}
                        className="rounded-full bg-purple-50 px-1.5 py-px text-[10px] font-medium text-[#681498]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
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
}: PageCanvasProps) {
  const [tagInput, setTagInput] = useState('');

  const submitTag = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const value = tagInput.trim();
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

  const availableSuggestions = DEFAULT_TAGS.filter((t) => !note.tags.includes(t)).slice(0, 3);

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
        <span className="ml-auto text-[11px] text-neutral-400">
          Edited {new Date(note.updatedAt).toLocaleString()}
        </span>
      </div>

      {/* Paper surface */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col rounded-sm bg-white shadow-panel ring-1 ring-black/5">
          <input
            value={note.title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Page title"
            aria-label="Page title"
            className="w-full border-b border-neutral-100 px-8 pb-2 pt-6 text-2xl font-semibold text-neutral-900 outline-none placeholder:text-neutral-300"
          />

          {/* Tag row */}
          <div className="flex flex-wrap items-center gap-1.5 px-8 pb-2 pt-3">
            {note.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-purple-50 py-0.5 pl-2 pr-1 text-xs font-medium text-[#681498]"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => onRemoveTag(tag)}
                  aria-label={`Remove tag ${tag}`}
                  className="flex h-4 w-4 items-center justify-center rounded-full text-[#681498]/70 hover:bg-purple-100 hover:text-[#681498]"
                >
                  ×
                </button>
              </span>
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
                  <option key={t} value={t} />
                ))}
              </datalist>
            </form>
          </div>

          {/* Body */}
          <textarea
            value={note.content}
            onChange={(e) => onContentChange(e.target.value)}
            placeholder="Start typing your notes…"
            aria-label="Page content"
            spellCheck
            className="min-h-[420px] w-full flex-1 resize-none px-8 pb-10 pt-2 text-[15px] text-neutral-800 outline-none placeholder:text-neutral-300"
            style={backgroundStyleFor(note.backgroundStyle)}
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
 * Root component
 * ======================================================================== */

export default function App() {
  const store = useNotes();
  const {
    notebooks,
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
    searchNotes,
  } = store;

  const [searchQuery, setSearchQuery] = useState('');

  const searchResults = useMemo(
    () => (searchQuery.trim() ? searchNotes(searchQuery) : null),
    [searchQuery, searchNotes],
  );

  /* Displayed page list: search results override the section filter. */
  const displayedPages = searchResults ?? activeSectionNotes;

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
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        isSaving={isSaving}
        lastSavedAt={lastSavedAt}
        onNewPage={handleNewPage}
        onNewSection={handleNewSection}
        onNewNotebook={handleNewNotebook}
        disabled={!activeNotebook}
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
            pages={displayedPages}
            activePageId={store.activePageId}
            onSelect={selectPage}
            onTogglePin={togglePin}
            onDelete={deletePage}
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
            if (activeNote) addTag(activeNote.id, tag);
          }}
          onRemoveTag={(tag) => {
            if (activeNote) removeTag(activeNote.id, tag);
          }}
        />
      </div>

      <StatusBar
        breadcrumb={breadcrumb}
        stats={stats}
        isSaving={isSaving}
        lastSavedAt={lastSavedAt}
      />
    </div>
  );
}
