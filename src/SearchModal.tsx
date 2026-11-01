/**
 * SearchModal.tsx
 * ---------------------------------------------------------------------------
 * Phase 3 global instant-search surface for the OneNote Clone.
 *
 * Opened by clicking the header search bar or pressing Ctrl+F / Cmd+F. The
 * query is debounced (150 ms) and matched against every note's title, tags,
 * and rich-text body through `useNotes().searchAllNotes()`. Results show a
 * highlighted breadcrumb + content snippet and support full keyboard
 * navigation (↑/↓ to move, Enter to open, Esc to close).
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { NoteSearchResult } from './useNotes';
import { highlightSegments, htmlToPlainText } from './richText';

/* ==========================================================================
 * Props
 * ======================================================================== */

interface SearchModalProps {
  /** Whether the modal is currently mounted/visible. */
  open: boolean;
  /** Close request (Esc key, backdrop click, or result activation). */
  onClose: () => void;
  /** Global search engine supplied by the useNotes store. */
  searchAllNotes: (query: string) => NoteSearchResult[];
  /** Activate a hit: navigates notebook → section → page. */
  onSelectResult: (result: NoteSearchResult) => void;
}

const DEBOUNCE_MS = 150;
const MAX_VISIBLE_RESULTS = 24;
const SNIPPET_RADIUS = 48;

/* ==========================================================================
 * Snippet extraction
 * ======================================================================== */

interface Snippet {
  before: string;
  match: string;
  after: string;
}

function buildSnippet(body: string, query: string): Snippet {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return { before: '', match: '', after: '' };
  const index = flat.toLowerCase().indexOf(query.trim().toLowerCase());
  if (index === -1) {
    return { before: flat.slice(0, SNIPPET_RADIUS * 2), match: '', after: '' };
  }
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(flat.length, index + query.trim().length + SNIPPET_RADIUS);
  return {
    before: (start > 0 ? '…' : '') + flat.slice(start, index),
    match: flat.slice(index, index + query.trim().length),
    after: flat.slice(index + query.trim().length, end) + (end < flat.length ? '…' : ''),
  };
}

/* ==========================================================================
 * Highlighted text helper
 * ======================================================================== */

function Highlighted({ text, query }: { text: string; query: string }) {
  const segments = useMemo(() => highlightSegments(text, query), [text, query]);
  return (
    <>
      {segments.map((segment, i) =>
        segment.match ? (
          <mark key={`${i}-m`} className="rounded-sm bg-amber-200 px-px text-neutral-900">
            {segment.text}
          </mark>
        ) : (
          <span key={`${i}-p`}>{segment.text}</span>
        ),
      )}
    </>
  );
}

/* ==========================================================================
 * Component
 * ======================================================================== */

export default function SearchModal({ open, onClose, searchAllNotes, onSelectResult }: SearchModalProps) {
  const [rawQuery, setRawQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const debounceRef = useRef<number | null>(null);

  /* Reset transient state each time the modal opens. */
  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  /* Debounce the raw keystrokes into a query used for matching. */
  useEffect(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      setDebouncedQuery(rawQuery);
      setActiveIndex(0);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [rawQuery]);

  const results = useMemo<NoteSearchResult[]>(
    () => (debouncedQuery.trim().length > 0 ? searchAllNotes(debouncedQuery).slice(0, MAX_VISIBLE_RESULTS) : []),
    [debouncedQuery, searchAllNotes],
  );

  const activate = useCallback(
    (result: NoteSearchResult | undefined): void => {
      if (!result) return;
      onSelectResult(result);
      onClose();
    },
    [onClose, onSelectResult],
  );

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((prev) => (results.length === 0 ? 0 : (prev + 1) % results.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) => (results.length === 0 ? 0 : (prev - 1 + results.length) % results.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      activate(results[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  /* Keep the active row scrolled into view while arrow-navigating. */
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, results.length]);

  if (!open) return null;

  const trimmed = debouncedQuery.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[10vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Search all notes"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl ring-1 ring-black/10">
        {/* Query field */}
        <div className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0 text-[#681498]" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
            <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={rawQuery}
            onChange={(event) => setRawQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search titles, tags and page content…  (Ctrl+F)"
            aria-label="Search query"
            aria-controls="search-results-list"
            aria-expanded={trimmed.length > 0}
            className="h-8 flex-1 border-none bg-transparent text-[15px] text-neutral-900 outline-none placeholder:text-neutral-400"
          />
          {rawQuery.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setRawQuery('');
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="rounded px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100"
            >
              Clear
            </button>
          )}
          <kbd className="hidden rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 text-[10px] text-neutral-500 sm:block">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {trimmed.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-neutral-500">
              Type to search across every notebook, section and page — instantly.
            </p>
          )}
          {trimmed.length > 0 && results.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-neutral-500">
              No pages match “<span className="font-medium text-neutral-700">{trimmed}</span>”.
            </p>
          )}
          {results.length > 0 && (
            <>
              <div className="flex items-center justify-between px-4 pb-1 pt-2 text-[11px] uppercase tracking-wide text-neutral-400">
                <span>
                  {results.length} page{results.length === 1 ? '' : 's'} found
                </span>
                <span>↑ ↓ to navigate · Enter to open</span>
              </div>
              <ul id="search-results-list" ref={listRef} role="listbox" aria-label="Search results" className="pb-2">
                {results.map((result, index) => {
                  const plainBody = htmlToPlainText(result.note.content).replace(/\s+/g, ' ').trim();
                  const snippet = buildSnippet(plainBody, trimmed);
                  const isActive = index === activeIndex;
                  return (
                    <li key={result.note.id} role="option" aria-selected={isActive}>
                      <button
                        type="button"
                        onClick={() => activate(result)}
                        onMouseEnter={() => setActiveIndex(index)}
                        className={`block w-full px-4 py-2.5 text-left transition ${
                          isActive ? 'bg-purple-50' : 'hover:bg-neutral-50'
                        }`}
                      >
                        <div className="flex items-baseline gap-2">
                          <span className={`truncate text-sm font-semibold ${isActive ? 'text-[#681498]' : 'text-neutral-800'}`}>
                            <Highlighted text={result.note.title} query={trimmed} />
                          </span>
                          {result.note.pinned && <span className="shrink-0 text-[10px] text-[#681498]" aria-label="Pinned">📌</span>}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-neutral-500">
                          {result.notebook?.name ?? 'Unknown notebook'} › {result.section?.name ?? 'Unknown section'}
                        </div>
                        {snippet.match.length > 0 || snippet.before.length > 0 ? (
                          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-neutral-600">
                            <span>{snippet.before}</span>
                            {snippet.match.length > 0 && (
                              <mark className="rounded-sm bg-amber-200 px-px text-neutral-900">{snippet.match}</mark>
                            )}
                            <span>{snippet.after}</span>
                          </p>
                        ) : (
                          <p className="mt-1 text-xs italic text-neutral-400">Matched by tag</p>
                        )}
                        {result.note.tags.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {result.note.tags.map((tag) => (
                              <span key={tag} className="rounded-full bg-purple-50 px-1.5 py-px text-[10px] font-medium text-[#681498]">
                                <Highlighted text={tag} query={trimmed} />
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
