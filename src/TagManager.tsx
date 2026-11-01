/**
 * TagManager.tsx
 * ---------------------------------------------------------------------------
 * Phase 3 color-coded tag management for the OneNote Clone.
 *
 * The registry (`TagDefinition[]`) lives in `useNotes` and persists to its
 * own localStorage key. This module exposes two surfaces:
 *
 *   • `TagChip`        — a colored pill used on pages and in the sidebar,
 *                        with optional remove/edit affordances.
 *   • `TagManagerPanel`— create / rename / recolor / delete custom tags,
 *                        shown from the Pages column header.
 *
 * Notes reference tags by display name; renaming or deleting a definition is
 * cascaded through every note by the store so data stays consistent.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { TagDefinition } from './types';
import { TAG_COLOR_PALETTE } from './types';

/* ==========================================================================
 * Utilities
 * ======================================================================== */

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Readable ink color (black/white) for a given chip background. */
export function contrastTextFor(hexColor: string): string {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hexColor.trim());
  if (!match) return '#1f1f1f';
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  // ITU-R BT.601 relative luminance.
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#1f1f1f' : '#ffffff';
}

/* ==========================================================================
 * TagChip
 * ======================================================================== */

interface TagChipProps {
  /** Registry entry; when absent the chip renders neutral styling. */
  definition: TagDefinition | undefined;
  /** Display name (source of truth even for unregistered legacy labels). */
  name: string;
  /** Show an × button that calls this with the tag name. */
  onRemove?: (name: string) => void;
  /** Click handler — used by the sidebar filter toggles. */
  onClick?: () => void;
  /** Whether this chip represents an active filter. */
  active?: boolean;
  /** Render size: compact for lists, regular for the page toolbar. */
  size?: 'sm' | 'md';
  title?: string;
}

export function TagChip({ definition, name, onRemove, onClick, active = false, size = 'md', title }: TagChipProps) {
  const color = definition?.color ?? '#767676';
  const text = contrastTextFor(color);
  const interactive = onClick !== undefined;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium transition ${
        size === 'sm' ? 'px-1.5 py-px text-[10px]' : 'px-2 py-0.5 text-xs'
      } ${interactive ? 'cursor-pointer hover:brightness-95' : ''} ${active ? 'ring-2 ring-offset-1 ring-[#681498]' : ''}`}
      style={{ backgroundColor: color, color: text }}
      title={title ?? name}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? active : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      {name}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove tag ${name}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove(name);
          }}
          className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[10px] leading-none opacity-70 hover:bg-black/20 hover:opacity-100"
          style={{ color: text }}
        >
          ×
        </button>
      )}
    </span>
  );
}

/* ==========================================================================
 * TagManagerPanel
 * ======================================================================== */

interface TagManagerPanelProps {
  tags: TagDefinition[];
  /** Live usage counts keyed by tag name (computed by the parent). */
  usageCounts: ReadonlyMap<string, number>;
  onCreate: (name: string, color: string) => void;
  onRename: (tagId: string, name: string) => void;
  onRecolor: (tagId: string, color: string) => void;
  onDelete: (tagId: string) => void;
  onClose: () => void;
}

export function TagManagerPanel({
  tags,
  usageCounts,
  onCreate,
  onRename,
  onRecolor,
  onDelete,
  onClose,
}: TagManagerPanelProps) {
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<string>(TAG_COLOR_PALETTE[0] ?? '#681498');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const panelRef = useRef<HTMLDivElement | null>(null);

  /* Close on outside click / Escape while the panel is open. */
  useEffect(() => {
    const handlePointer = (event: MouseEvent): void => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose();
    };
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const submitCreate = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = newName.trim();
      if (!trimmed) return;
      onCreate(trimmed, newColor);
      setNewName('');
      setNewColor(TAG_COLOR_PALETTE[(tags.length + 1) % TAG_COLOR_PALETTE.length] ?? '#681498');
    },
    [newColor, newName, onCreate, tags.length],
  );

  const commitRename = useCallback(() => {
    if (editingId && editDraft.trim()) onRename(editingId, editDraft);
    setEditingId(null);
    setEditDraft('');
  }, [editDraft, editingId, onRename]);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Tag manager"
      className="absolute right-1 top-8 z-30 w-72 rounded-lg border border-neutral-200 bg-white p-3 shadow-xl"
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-800">Manage tags</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close tag manager"
          className="rounded px-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        >
          ✕
        </button>
      </div>

      {/* Existing tags */}
      <ul className="max-h-52 space-y-1 overflow-y-auto pr-1">
        {tags.length === 0 && (
          <li className="py-2 text-center text-xs italic text-neutral-500">No tags yet — create one below.</li>
        )}
        {tags.map((tag) => {
          const usage = usageCounts.get(tag.name) ?? 0;
          return (
            <li key={tag.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-neutral-50">
              <input
                type="color"
                value={HEX_PATTERN.test(tag.color) ? tag.color : '#681498'}
                onChange={(event) => onRecolor(tag.id, event.target.value)}
                aria-label={`Color for tag ${tag.name}`}
                className="h-5 w-5 shrink-0 cursor-pointer rounded border border-neutral-300 bg-white p-0"
              />
              {editingId === tag.id ? (
                <input
                  autoFocus
                  value={editDraft}
                  onChange={(event) => setEditDraft(event.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitRename();
                    if (event.key === 'Escape') setEditingId(null);
                  }}
                  aria-label="Rename tag"
                  className="h-6 min-w-0 flex-1 rounded border border-purple-400 px-1.5 text-xs outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(tag.id);
                    setEditDraft(tag.name);
                  }}
                  title="Rename tag"
                  className="min-w-0 flex-1 truncate text-left text-xs font-medium text-neutral-700 hover:text-[#681498]"
                >
                  <TagChip definition={tag} name={tag.name} size="sm" />
                  <span className="ml-2 text-[10px] text-neutral-400">
                    {usage} page{usage === 1 ? '' : 's'}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onDelete(tag.id)}
                title="Delete tag (removes it from all pages)"
                aria-label={`Delete tag ${tag.name}`}
                className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-red-100 hover:text-red-600 group-hover:flex"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 7h14M10 7V5h4v2m-8 0 1 13h8l1-13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Create form */}
      <form onSubmit={submitCreate} className="mt-3 border-t border-neutral-100 pt-3">
        <label htmlFor="new-tag-name" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          New custom tag
        </label>
        <div className="flex items-center gap-2">
          <input
            id="new-tag-name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="e.g. Research"
            maxLength={32}
            className="h-7 min-w-0 flex-1 rounded border border-neutral-300 px-2 text-xs outline-none focus:border-purple-500"
          />
          <input
            type="color"
            value={HEX_PATTERN.test(newColor) ? newColor : '#681498'}
            onChange={(event) => setNewColor(event.target.value)}
            aria-label="New tag color"
            className="h-7 w-8 shrink-0 cursor-pointer rounded border border-neutral-300 bg-white p-0.5"
          />
          <button
            type="submit"
            disabled={newName.trim().length === 0}
            className="h-7 shrink-0 rounded bg-[#681498] px-2.5 text-xs font-semibold text-white transition hover:bg-[#520f78] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add
          </button>
        </div>
        <p className="mt-1.5 text-[10px] leading-snug text-neutral-400">
          Custom tags appear on pages and can filter the page list from the sidebar.
        </p>
      </form>
    </div>
  );
}
