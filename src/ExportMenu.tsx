/**
 * ExportMenu.tsx
 * ---------------------------------------------------------------------------
 * Phase 3 multi-format export ribbon for the OneNote Clone.
 *
 * A File/Review-style dropdown offering four functional triggers:
 *   • Markdown (.md)      — clean conversion of the active page body
 *   • Plain Text (.txt)   — flowing text extraction of the active page
 *   • HTML file (.html)   — standalone styled document for the active page
 *   • JSON Backup (.json) — full notebooks + sections + pages snapshot
 *
 * All exports run client-side via `exporters.ts` and download through a
 * generated Blob URL. The menu closes on outside click or Escape.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Note, Notebook } from './types';
import {
  backupFilename,
  buildJsonBackup,
  buildStandaloneHtmlDocument,
  downloadFile,
  htmlFilename,
  htmlToMarkdown,
  htmlToPlainTxt,
  markdownFilename,
  plainTextFilename,
} from './exporters';

/* ==========================================================================
 * Types
 * ======================================================================== */

type ExportFormat = 'markdown' | 'text' | 'html' | 'json';

interface ExportMenuProps {
  /** Active page (or null when nothing is selected). */
  note: Note | null;
  /** Owning section name for breadcrumbs in exported documents. */
  sectionName: string;
  /** Owning notebook name for breadcrumbs in exported documents. */
  notebookName: string;
  /** Full workspace, used by the JSON backup trigger. */
  notebooks: Notebook[];
  notes: Note[];
  /** Optional toast sink so App can surface "Exported …" confirmations. */
  onExported?: (format: ExportFormat, filename: string) => void;
}

interface FormatDescriptor {
  format: ExportFormat;
  label: string;
  extension: string;
  description: string;
  perPage: boolean;
  iconPath: string;
}

const FORMATS: readonly FormatDescriptor[] = [
  {
    format: 'markdown',
    label: 'Markdown file',
    extension: '.md',
    description: 'Clean Markdown of the active page',
    perPage: true,
    iconPath: 'M4 7h16M4 12h10M4 17h7',
  },
  {
    format: 'text',
    label: 'Plain text',
    extension: '.txt',
    description: 'Formatted-free text of the active page',
    perPage: true,
    iconPath: 'M6 4h9l3 3v13H6V4Z M9 11h6M9 15h6',
  },
  {
    format: 'html',
    label: 'HTML page',
    extension: '.html',
    description: 'Standalone styled web page',
    perPage: true,
    iconPath: 'm9 8-4 4 4 4 M15 8l4 4-4 4',
  },
  {
    format: 'json',
    label: 'JSON backup',
    extension: '.json',
    description: 'All notebooks, sections & pages',
    perPage: false,
    iconPath: 'M12 3v4M12 17v4 M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8 M3 12h4M17 12h4',
  },
];

/* ==========================================================================
 * Component
 * ======================================================================== */

export default function ExportMenu({
  note,
  sectionName,
  notebookName,
  notebooks,
  notes,
  onExported,
}: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  /* Dismiss on outside click / Escape. */
  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const runExport = useCallback(
    (format: ExportFormat) => {
      setOpen(false);
      switch (format) {
        case 'markdown': {
          if (!note) return;
          const filename = markdownFilename(note);
          downloadFile(filename, htmlToMarkdown(note.content), 'text/markdown');
          onExported?.(format, filename);
          break;
        }
        case 'text': {
          if (!note) return;
          const filename = plainTextFilename(note);
          downloadFile(filename, htmlToPlainTxt(note.content), 'text/plain');
          onExported?.(format, filename);
          break;
        }
        case 'html': {
          if (!note) return;
          const filename = htmlFilename(note);
          downloadFile(filename, buildStandaloneHtmlDocument(note, sectionName, notebookName), 'text/html');
          onExported?.(format, filename);
          break;
        }
        case 'json': {
          const filename = backupFilename();
          downloadFile(filename, buildJsonBackup(notebooks, notes), 'application/json');
          onExported?.(format, filename);
          break;
        }
      }
    },
    [note, notebookName, notes, notebooks, onExported, sectionName],
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 items-center gap-1.5 rounded-md border border-white/25 px-3 text-xs font-medium text-white transition hover:bg-white/10"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 3v11m0 0 4-4m-4 4-4-4 M5 19h14"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Export
        <span className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Export formats"
          className="absolute right-0 top-9 z-40 w-72 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-xl"
        >
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            File · Review — Export
          </p>
          {FORMATS.map((descriptor) => {
            const disabled = descriptor.perPage && note === null;
            return (
              <button
                key={descriptor.format}
                type="button"
                role="menuitem"
                disabled={disabled}
                onClick={() => runExport(descriptor.format)}
                title={disabled ? 'Select a page to export it' : descriptor.description}
                className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="mt-0.5 shrink-0 text-[#681498]" aria-hidden="true">
                  <path d={descriptor.iconPath} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-neutral-800">
                    {descriptor.label}{' '}
                    <span className="rounded bg-neutral-100 px-1 py-px font-mono text-[10px] text-neutral-500">
                      {descriptor.extension}
                    </span>
                  </span>
                  <span className="block truncate text-xs text-neutral-500">{descriptor.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
