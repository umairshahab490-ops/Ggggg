/**
 * RichTextEditor.tsx
 * ---------------------------------------------------------------------------
 * Phase 2 rich-text editing surface for the OneNote Clone.
 *
 * Design notes:
 *   • `contentEditable` div with an uncontrolled DOM — React never re-writes
 *     innerHTML while the user types (which would destroy caret position).
 *     External content changes (page navigation, undo) are detected via a
 *     signature and applied only when they did not originate from this editor.
 *   • The formatting ribbon drives `document.execCommand`; every mutation is
 *     normalized through the sanitizer before bubbling up to the store.
 *   • Native Ctrl+Z / Ctrl+Y are intercepted and served by a custom snapshot
 *     history so undo also covers programmatic (sanitized) edits.
 *   • Paste is intercepted and sanitized; links open in a new tab.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ClipboardEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  BLOCK_OPTIONS,
  HIGHLIGHT_COLORS,
  INK_COLORS,
  handleSanitizedPaste,
  queryActiveBlock,
  sanitizeHtml,
} from './richText';

/* ==========================================================================
 * Props
 * ======================================================================== */

interface RichTextEditorProps {
  /** Unique id of the note being edited (drives re-seed on navigation). */
  noteId: string;
  /** Stored HTML for the note. */
  html: string;
  /** Called with sanitized HTML whenever the user mutates the document. */
  onChange: (html: string) => void;
  /** CSS background (paper rules) + line-height inherited from the page. */
  paperStyle?: React.CSSProperties;
  /** Placeholder text when the document is empty. */
  placeholder: string;
  /** Exposes imperative focus() to parent toolbars. */
  onEditorReady?: (element: HTMLDivElement | null) => void;
}

const HISTORY_LIMIT = 100;

/* ==========================================================================
 * Ribbon icons
 * ======================================================================== */

function RibbonIcon({ path, label }: { path: string; label: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={path} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <title>{label}</title>
    </svg>
  );
}

const RIBBON_PATHS = {
  undo: 'M9 14 4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'm15 14 5-5-5-5 M20 9H10a6 6 0 0 0 0 12h3',
  bullets: 'M9 6h11M9 12h11M9 18h11 M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  numbers: 'M10 6h10M10 12h10M10 18h10 M4 4.5h1.5V8 M3.5 16.5c0-1 2-1 2 .5S3.5 19 5.5 19',
  clear: 'M7 7h13M4 12h13 M14 17h6',
  highlighter: 'M4 20h6 M9.5 15.5 16 9l-3.5-3.5L6 12l3.5 3.5Z M14 5l5 5',
} as const;

/* ==========================================================================
 * Component
 * ======================================================================== */

export default function RichTextEditor({
  noteId,
  html,
  onChange,
  paperStyle,
  placeholder,
  onEditorReady,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  /** Last HTML we emitted upward — used to ignore our own props echo. */
  const lastEmittedRef = useRef<string>(html);
  /** Which note the DOM currently displays. */
  const displayedNoteIdRef = useRef<string>(noteId);
  const historyRef = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 });
  const suppressHistoryRef = useRef<boolean>(false);
  const commitTimerRef = useRef<number | null>(null);

  const [activeBlock, setActiveBlock] = useState<string>('p');
  const [historyTick, setHistoryTick] = useState(0);

  /* ----------------------------- Seeding ------------------------------- */

  const seedFromProps = useCallback(
    (value: string): void => {
      const element = editorRef.current;
      if (!element) return;
      const clean = sanitizeHtml(value);
      suppressHistoryRef.current = true;
      element.innerHTML = clean;
      lastEmittedRef.current = clean;
      historyRef.current = { stack: [clean], index: 0 };
      window.clearTimeout(commitTimerRef.current ?? undefined);
      commitTimerRef.current = null;
      setHistoryTick((t) => t + 1);
      // Releasing suppression after the current task lets the browser settle.
      window.setTimeout(() => {
        suppressHistoryRef.current = false;
      }, 0);
    },
    [],
  );

  // Re-seed when navigating to a different page, or when the stored HTML was
  // changed by something other than this editor (e.g. external undo).
  useLayoutEffect(() => {
    const element = editorRef.current;
    if (!element) return;
    if (displayedNoteIdRef.current !== noteId) {
      displayedNoteIdRef.current = noteId;
      seedFromProps(html);
      return;
    }
    if (sanitizeHtml(html) !== lastEmittedRef.current && document.activeElement !== element) {
      seedFromProps(html);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  /* --------------------------- Commit logic ---------------------------- */

  const pushHistory = useCallback((snapshot: string): void => {
    const history = historyRef.current;
    history.stack = history.stack.slice(0, history.index + 1);
    history.stack.push(snapshot);
    if (history.stack.length > HISTORY_LIMIT) history.stack.shift();
    history.index = history.stack.length - 1;
    setHistoryTick((t) => t + 1);
  }, []);

  const scheduleCommit = useCallback((): void => {
    if (suppressHistoryRef.current) return;
    const element = editorRef.current;
    if (!element) return;
    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
      const raw = element.innerHTML;
      const clean = sanitizeHtml(raw);
      if (clean !== raw) element.innerHTML = clean; // normalize DOM in place
      if (clean !== lastEmittedRef.current) {
        lastEmittedRef.current = clean;
        pushHistory(clean);
        onChange(clean);
      }
    }, 120);
  }, [onChange, pushHistory]);

  useEffect(() => {
    return () => window.clearTimeout(commitTimerRef.current ?? undefined);
  }, []);

  /* ------------------------------ Undo/Redo ---------------------------- */

  const applySnapshot = useCallback(
    (snapshot: string): void => {
      const element = editorRef.current;
      if (!element) return;
      suppressHistoryRef.current = true;
      element.innerHTML = snapshot;
      lastEmittedRef.current = snapshot;
      suppressHistoryRef.current = false;
      onChange(snapshot);
      setHistoryTick((t) => t + 1);
      element.focus();
    },
    [onChange],
  );

  const undo = useCallback((): void => {
    const history = historyRef.current;
    if (history.index <= 0) return;
    history.index -= 1;
    applySnapshot(history.stack[history.index]);
  }, [applySnapshot]);

  const redo = useCallback((): void => {
    const history = historyRef.current;
    if (history.index >= history.stack.length - 1) return;
    history.index += 1;
    applySnapshot(history.stack[history.index]);
  }, [applySnapshot]);

  /* ----------------------------- Commands ------------------------------ */

  const exec = useCallback(
    (command: string, value?: string): void => {
      const element = editorRef.current;
      if (!element) return;
      element.focus();
      try {
        document.execCommand(command, false, value);
      } catch {
        /* Some commands throw on detached selections — safe to ignore. */
      }
      scheduleCommit();
      setActiveBlock(queryActiveBlock());
    },
    [scheduleCommit],
  );

  const syncSelectionState = useCallback((): void => {
    const element = editorRef.current;
    if (!element) return;
    const selection = window.getSelection();
    if (selection && selection.anchorNode && element.contains(selection.anchorNode)) {
      setActiveBlock(queryActiveBlock());
    }
  }, []);

  useEffect(() => {
    document.addEventListener('selectionchange', syncSelectionState);
    return () => document.removeEventListener('selectionchange', syncSelectionState);
  }, [syncSelectionState]);

  /* ------------------------- Initial mount seed ------------------------ */

  useEffect(() => {
    onEditorReady?.(editorRef.current);
    seedFromProps(html);
    // Seed exactly once on mount; prop-driven reseeds handled above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ----------------------------- Keymap -------------------------------- */

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if ((mod && event.key.toLowerCase() === 'y') || (mod && event.shiftKey && event.key.toLowerCase() === 'z')) {
        event.preventDefault();
        redo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        exec('bold');
        return;
      }
      if (mod && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        exec('italic');
        return;
      }
      if (mod && event.key.toLowerCase() === 'u') {
        event.preventDefault();
        exec('underline');
        return;
      }
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        const url = window.prompt('Link URL');
        if (url && /^(https?:\/\/|mailto:)/i.test(url.trim())) {
          exec('createLink', url.trim());
        }
      }
    },
    [exec, redo, undo],
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>): void => {
      handleSanitizedPaste(event);
      scheduleCommit();
    },
    [scheduleCommit],
  );

  /* ------------------------------ Ribbon ------------------------------- */

  const history = historyRef.current;
  const canUndo = history.index > 0;
  const canRedo = history.index < history.stack.length - 1;
  void historyTick; // historyTick exists purely to force ribbon re-render.

  const ribbonButtonClass =
    'flex h-7 w-7 items-center justify-center rounded text-neutral-600 hover:bg-purple-50 hover:text-[#681498] ' +
    'disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Formatting ribbon */}
      <div
        role="toolbar"
        aria-label="Formatting toolbar"
        className="flex shrink-0 flex-wrap items-center gap-1 border-b border-neutral-200 bg-[#faf9f8] px-3 py-1"
      >
        <button type="button" className={ribbonButtonClass} onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
          <RibbonIcon path={RIBBON_PATHS.undo} label="Undo" />
        </button>
        <button type="button" className={ribbonButtonClass} onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Y)">
          <RibbonIcon path={RIBBON_PATHS.redo} label="Redo" />
        </button>

        <span className="mx-1 h-5 w-px bg-neutral-200" aria-hidden="true" />

        <select
          aria-label="Paragraph style"
          value={activeBlock}
          onChange={(event) => exec('formatBlock', `<${event.target.value}>`)}
          className="h-7 rounded border border-neutral-300 bg-white px-1.5 text-xs text-neutral-700 outline-none focus:border-purple-500"
        >
          {BLOCK_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <span className="mx-1 h-5 w-px bg-neutral-200" aria-hidden="true" />

        <button type="button" className={`${ribbonButtonClass} font-bold`} onClick={() => exec('bold')} aria-label="Bold" title="Bold (Ctrl+B)">
          B
        </button>
        <button type="button" className={`${ribbonButtonClass} italic`} onClick={() => exec('italic')} aria-label="Italic" title="Italic (Ctrl+I)">
          I
        </button>
        <button type="button" className={`${ribbonButtonClass} underline`} onClick={() => exec('underline')} aria-label="Underline" title="Underline (Ctrl+U)">
          U
        </button>
        <button type="button" className={`${ribbonButtonClass} line-through`} onClick={() => exec('strikeThrough')} aria-label="Strikethrough" title="Strikethrough">
          S
        </button>

        <span className="mx-1 h-5 w-px bg-neutral-200" aria-hidden="true" />

        {/* Font color swatches */}
        <div className="flex items-center gap-0.5" role="group" aria-label="Font color">
          {INK_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => exec('foreColor', color)}
              aria-label={`Font color ${color}`}
              title={`Font color ${color}`}
              className="h-4.5 w-4.5 rounded-sm border border-black/10 hover:scale-110"
              style={{ backgroundColor: color, width: 18, height: 18 }}
            />
          ))}
        </div>

        <span className="mx-1 h-5 w-px bg-neutral-200" aria-hidden="true" />

        {/* Highlight swatches */}
        <div className="flex items-center gap-0.5" role="group" aria-label="Highlight color">
          <RibbonIcon path={RIBBON_PATHS.highlighter} label="Highlight" />
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => exec('hiliteColor', color)}
              aria-label={`Highlight ${color}`}
              title={`Highlight ${color}`}
              className="rounded-sm border border-black/10 hover:scale-110"
              style={{ backgroundColor: color, width: 18, height: 18 }}
            />
          ))}
          <button
            type="button"
            onClick={() => exec('hiliteColor', 'transparent')}
            aria-label="Remove highlight"
            title="Remove highlight"
            className="rounded-sm border border-dashed border-neutral-400 bg-white text-[9px] leading-none text-neutral-500"
            style={{ width: 18, height: 18 }}
          >
            ∅
          </button>
        </div>

        <span className="mx-1 h-5 w-px bg-neutral-200" aria-hidden="true" />

        <button type="button" className={ribbonButtonClass} onClick={() => exec('insertUnorderedList')} aria-label="Bullet list" title="Bullet list">
          <RibbonIcon path={RIBBON_PATHS.bullets} label="Bullets" />
        </button>
        <button type="button" className={ribbonButtonClass} onClick={() => exec('insertOrderedList')} aria-label="Numbered list" title="Numbered list">
          <RibbonIcon path={RIBBON_PATHS.numbers} label="Numbering" />
        </button>
        <button type="button" className={ribbonButtonClass} onClick={() => exec('removeFormat')} aria-label="Clear formatting" title="Clear formatting">
          <RibbonIcon path={RIBBON_PATHS.clear} label="Clear" />
        </button>
      </div>

      {/* Editable surface */}
      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-label="Page content"
        data-placeholder={placeholder}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        className="rich-editor min-h-[420px] flex-1 px-8 pb-16 pt-2 text-[15px] leading-relaxed text-neutral-800 caret-[#681498]"
        style={paperStyle}
        onInput={scheduleCommit}
        onBlur={scheduleCommit}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
      />
    </div>
  );
}
