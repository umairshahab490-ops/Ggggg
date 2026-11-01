/**
 * useNotes.ts
 * ---------------------------------------------------------------------------
 * Central state engine for the OneNote Clone.
 *
 * Responsibilities:
 *  • Owns the full Notebook -> Section -> Note hierarchy.
 *  • Persists everything to localStorage with a debounced auto-save.
 *  • Exposes typed CRUD + navigation + tagging/pinning operations.
 *  • Derives real-time text statistics for the active page.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BackgroundStyle,
  DrawingData,
  Note,
  Notebook,
  NotesState,
  Section,
  TextStatistics,
} from './types';
import {
  NOTES_STORAGE_KEY,
  SECTION_PALETTE,
} from './types';

/** Debounce window (ms) before the state is flushed to localStorage. */
const AUTOSAVE_DEBOUNCE_MS = 600;

/* --------------------------------------------------------------------------
 * ID generation — crypto.randomUUID when available, RFC4122-ish fallback.
 * ------------------------------------------------------------------------ */
function generateId(prefix: string): string {
  const cryptoRef = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return `${prefix}_${cryptoRef.randomUUID()}`;
  }
  const rand = () =>
    Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .slice(1);
  return `${prefix}_${rand()}${rand()}-${rand()}-${rand()}`;
}

/* --------------------------------------------------------------------------
 * Factory helpers (module-private; the hook exposes createXxx actions that
 * wrap these so there is never a naming collision inside callbacks).
 * ------------------------------------------------------------------------ */
function makeNotebook(name: string, sections: Section[] = []): Notebook {
  return { id: generateId('nb'), name, sections };
}

function makeSection(name: string, notebookId: string, colorIndex = 0): Section {
  return {
    id: generateId('sec'),
    name,
    color: SECTION_PALETTE[colorIndex % SECTION_PALETTE.length],
    notebookId,
  };
}

function makeNote(sectionId: string, overrides: Partial<Note> = {}): Note {
  const now = Date.now();
  return {
    id: generateId('note'),
    title: 'Untitled page',
    content: '',
    sectionId,
    createdAt: now,
    updatedAt: now,
    pinned: false,
    tags: [],
    backgroundStyle: 'plain',
    drawings: '',
    ...overrides,
  };
}

/* --------------------------------------------------------------------------
 * Seed data shown on first launch (empty localStorage).
 * ------------------------------------------------------------------------ */
function buildInitialState(): NotesState {
  const notebook = makeNotebook("Quick Notes");
  const personal = makeSection("Personal", notebook.id, 0);
  const work = makeSection("Work", notebook.id, 3);
  notebook.sections = [personal, work];

  const welcome = makeNote(personal.id, {
    title: 'Welcome to OneNote Clone',
    content:
      'This is your new digital notebook.\n\n' +
      'Pages live inside Sections, and Sections live inside Notebooks.\n' +
      'Everything you type is auto-saved to your browser.\n\n' +
      'Try creating a new page, pinning it, or adding a tag.',
    tags: ['Important'],
    backgroundStyle: 'lined',
  });

  const meeting = makeNote(work.id, {
    title: 'Project Kickoff Notes',
    content:
      'Agenda:\n' +
      '1. Scope and milestones\n' +
      '2. Design review cadence\n' +
      '3. Ownership matrix\n',
    tags: ['To-Do', 'Follow Up'],
    pinned: true,
  });

  return {
    notebooks: [notebook],
    notes: [welcome, meeting],
    activeNotebookId: notebook.id,
    activeSectionId: personal.id,
    activePageId: welcome.id,
  };
}

/* --------------------------------------------------------------------------
 * Persistence validation — guard against malformed / tampered payloads.
 * ------------------------------------------------------------------------ */
function isNote(value: unknown): value is Note {
  if (typeof value !== 'object' || value === null) return false;
  const n = value as Record<string, unknown>;
  return (
    typeof n.id === 'string' &&
    typeof n.title === 'string' &&
    typeof n.content === 'string' &&
    typeof n.sectionId === 'string' &&
    typeof n.createdAt === 'number' &&
    typeof n.updatedAt === 'number' &&
    typeof n.pinned === 'boolean' &&
    Array.isArray(n.tags) &&
    (n.backgroundStyle === 'plain' || n.backgroundStyle === 'lined' || n.backgroundStyle === 'grid') &&
    (typeof n.drawings === 'string' || typeof n.drawings === 'object')
  );
}

function isSection(value: unknown): value is Section {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    typeof s.color === 'string' &&
    typeof s.notebookId === 'string'
  );
}

function isNotebook(value: unknown): value is Notebook {
  if (typeof value !== 'object' || value === null) return false;
  const nb = value as Record<string, unknown>;
  return (
    typeof nb.id === 'string' &&
    typeof nb.name === 'string' &&
    Array.isArray(nb.sections) &&
    nb.sections.every(isSection)
  );
}

function loadState(): NotesState {
  try {
    const raw = window.localStorage.getItem(NOTES_STORAGE_KEY);
    if (!raw) return buildInitialState();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return buildInitialState();
    const candidate = parsed as Record<string, unknown>;
    const { notebooks, notes } = candidate;
    if (!Array.isArray(notebooks) || !Array.isArray(notes)) return buildInitialState();
    if (!notebooks.every(isNotebook) || !notes.every(isNote)) return buildInitialState();

    const state: NotesState = {
      notebooks: notebooks as Notebook[],
      notes: notes as Note[],
      activeNotebookId:
        typeof candidate.activeNotebookId === 'string' ? candidate.activeNotebookId : null,
      activeSectionId:
        typeof candidate.activeSectionId === 'string' ? candidate.activeSectionId : null,
      activePageId: typeof candidate.activePageId === 'string' ? candidate.activePageId : null,
    };

    // Repair dangling references so the UI can never point at deleted entities.
    if (state.activeNotebookId && !state.notebooks.some((nb) => nb.id === state.activeNotebookId)) {
      state.activeNotebookId = state.notebooks[0]?.id ?? null;
    }
    const activeNotebook = state.notebooks.find((nb) => nb.id === state.activeNotebookId);
    if (state.activeSectionId && !activeNotebook?.sections.some((s) => s.id === state.activeSectionId)) {
      state.activeSectionId = activeNotebook?.sections[0]?.id ?? null;
    }
    if (state.activePageId && !state.notes.some((n) => n.id === state.activePageId)) {
      state.activePageId = null;
    }
    return state;
  } catch {
    return buildInitialState();
  }
}

/* --------------------------------------------------------------------------
 * Statistics
 * ------------------------------------------------------------------------ */
function computeStatistics(content: string): TextStatistics {
  const trimmed = content.trim();
  const wordCount = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
  const characterCount = content.length;
  const characterCountNoSpaces = content.replace(/\s/g, '').length;
  const lineCount = content.length === 0 ? 0 : content.split('\n').length;
  const readingTimeMinutes = Math.max(wordCount === 0 ? 0 : 1, Math.round(wordCount / 200));
  return { wordCount, characterCount, characterCountNoSpaces, lineCount, readingTimeMinutes };
}

/* --------------------------------------------------------------------------
 * Public hook surface
 * ------------------------------------------------------------------------ */
export interface UseNotesResult {
  /* Raw collections */
  notebooks: Notebook[];
  notes: Note[];

  /* Derived active-path selections */
  activeNotebook: Notebook | null;
  activeSection: Section | null;
  activeNote: Note | null;
  activeSections: Section[];
  activeSectionNotes: Note[];
  pinnedNotes: Note[];

  /* Navigation ids (for controlled highlight styling) */
  activeNotebookId: string | null;
  activeSectionId: string | null;
  activePageId: string | null;

  /* Navigation actions */
  selectNotebook: (notebookId: string) => void;
  selectSection: (sectionId: string) => void;
  selectPage: (pageId: string) => void;

  /* Notebook actions */
  createNotebook: (name: string) => Notebook;
  renameNotebook: (notebookId: string, name: string) => void;
  deleteNotebook: (notebookId: string) => void;

  /* Section actions */
  createSection: (name: string, color?: string) => Section | null;
  renameSection: (sectionId: string, name: string) => void;
  setSectionColor: (sectionId: string, color: string) => void;
  deleteSection: (sectionId: string) => void;

  /* Page (Note) actions */
  createPage: (overrides?: Partial<Note>) => Note | null;
  updatePageContent: (pageId: string, content: string) => void;
  renamePage: (pageId: string, title: string) => void;
  deletePage: (pageId: string) => void;
  togglePin: (pageId: string) => void;
  addTag: (pageId: string, tag: string) => void;
  removeTag: (pageId: string, tag: string) => void;
  setBackgroundStyle: (pageId: string, style: BackgroundStyle) => void;
  setDrawings: (pageId: string, drawings: Note['drawings']) => void;

  /* Search */
  searchNotes: (query: string) => Note[];

  /* Persistence signals */
  stats: TextStatistics;
  isSaving: boolean;
  lastSavedAt: number | null;
  saveNow: () => void;
}

/**
 * Master state hook for the entire notebook hierarchy.
 */
export function useNotes(): UseNotesResult {
  const [state, setState] = useState<NotesState>(loadState);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  // Always-current snapshot for timers/event handlers outside render cycle.
  const stateRef = useRef<NotesState>(state);
  stateRef.current = state;

  /* ----------------------- Debounced auto-save ------------------------- */
  const saveTimerRef = useRef<number | null>(null);

  const writeSnapshot = useCallback(() => {
    try {
      window.localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(stateRef.current));
      setLastSavedAt(Date.now());
    } catch {
      // Storage quota exceeded or disabled storage — fail silently in Phase 1.
    } finally {
      setIsSaving(false);
    }
  }, []);

  useEffect(() => {
    setIsSaving(true);
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      writeSnapshot();
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [state, writeSnapshot]);

  // Flush pending changes when the tab is hidden or closed.
  useEffect(() => {
    const flush = () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      writeSnapshot();
    };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, [writeSnapshot]);

  const saveNow = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    writeSnapshot();
  }, [writeSnapshot]);

  /* --------------------------- Selectors ------------------------------- */
  const activeNotebook = useMemo(
    () => state.notebooks.find((nb) => nb.id === state.activeNotebookId) ?? null,
    [state.notebooks, state.activeNotebookId],
  );

  const activeSections = useMemo<Section[]>(
    () => activeNotebook?.sections ?? [],
    [activeNotebook],
  );

  const activeSection = useMemo(
    () => activeSections.find((s) => s.id === state.activeSectionId) ?? null,
    [activeSections, state.activeSectionId],
  );

  const activeSectionNotes = useMemo(
    () =>
      activeSection
        ? state.notes
            .filter((n) => n.sectionId === activeSection.id)
            .sort((a, b) => b.updatedAt - a.updatedAt)
        : [],
    [state.notes, activeSection],
  );

  const activeNote = useMemo(
    () => state.notes.find((n) => n.id === state.activePageId) ?? null,
    [state.notes, state.activePageId],
  );

  const pinnedNotes = useMemo(
    () => state.notes.filter((n) => n.pinned).sort((a, b) => b.updatedAt - a.updatedAt),
    [state.notes],
  );

  const stats = useMemo<TextStatistics>(
    () => computeStatistics(activeNote?.content ?? ''),
    [activeNote?.content],
  );

  /* ----------------------- Navigation actions -------------------------- */
  const selectNotebook = useCallback((notebookId: string) => {
    setState((prev) => {
      const notebook = prev.notebooks.find((nb) => nb.id === notebookId);
      if (!notebook) return prev;
      const firstSection = notebook.sections[0] ?? null;
      const firstPage = firstSection
        ? prev.notes
            .filter((n) => n.sectionId === firstSection.id)
            .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
        : null;
      return {
        ...prev,
        activeNotebookId: notebook.id,
        activeSectionId: firstSection?.id ?? null,
        activePageId: firstPage?.id ?? null,
      };
    });
  }, []);

  const selectSection = useCallback((sectionId: string) => {
    setState((prev) => {
      const owningNotebook = prev.notebooks.find((nb) =>
        nb.sections.some((s) => s.id === sectionId),
      );
      if (!owningNotebook) return prev;
      const firstPage = prev.notes
        .filter((n) => n.sectionId === sectionId)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
      return {
        ...prev,
        activeNotebookId: owningNotebook.id,
        activeSectionId: sectionId,
        activePageId: firstPage?.id ?? null,
      };
    });
  }, []);

  const selectPage = useCallback((pageId: string) => {
    setState((prev) => {
      const note = prev.notes.find((n) => n.id === pageId);
      if (!note) return prev;
      const owningNotebook = prev.notebooks.find((nb) =>
        nb.sections.some((s) => s.id === note.sectionId),
      );
      return {
        ...prev,
        activeNotebookId: owningNotebook?.id ?? prev.activeNotebookId,
        activeSectionId: note.sectionId,
        activePageId: note.id,
      };
    });
  }, []);

  /* ----------------------- Notebook actions ---------------------------- */
  const createNotebook = useCallback((name: string): Notebook => {
    const trimmed = name.trim() || 'New Notebook';
    let created!: Notebook;
    setState((prev) => {
      const notebook = makeNotebook(trimmed);
      const firstSection = makeSection("Quick Notes", notebook.id, prev.notebooks.length);
      notebook.sections = [firstSection];
      const firstPage = makeNote(firstSection.id, { title: 'New Page' });
      created = notebook;
      return {
        notebooks: [...prev.notebooks, notebook],
        notes: [...prev.notes, firstPage],
        activeNotebookId: notebook.id,
        activeSectionId: firstSection.id,
        activePageId: firstPage.id,
      };
    });
    return created;
  }, []);

  const renameNotebook = useCallback((notebookId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setState((prev) => ({
      ...prev,
      notebooks: prev.notebooks.map((nb) =>
        nb.id === notebookId ? { ...nb, name: trimmed } : nb,
      ),
    }));
  }, []);

  const deleteNotebook = useCallback((notebookId: string) => {
    setState((prev) => {
      const target = prev.notebooks.find((nb) => nb.id === notebookId);
      if (!target) return prev;
      const removedSectionIds = new Set(target.sections.map((s) => s.id));
      const notebooks = prev.notebooks.filter((nb) => nb.id !== notebookId);
      const notes = prev.notes.filter((n) => !removedSectionIds.has(n.sectionId));

      const nextActive = notebooks[0] ?? null;
      const nextSection = nextActive?.sections[0] ?? null;
      const nextPage = nextSection
        ? notes.filter((n) => n.sectionId === nextSection.id).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
        : null;

      return {
        notebooks,
        notes,
        activeNotebookId: prev.activeNotebookId === notebookId ? nextActive?.id ?? null : prev.activeNotebookId,
        activeSectionId: prev.activeNotebookId === notebookId ? nextSection?.id ?? null : prev.activeSectionId,
        activePageId: prev.activeNotebookId === notebookId ? nextPage?.id ?? null : prev.activePageId,
      };
    });
  }, []);

  /* ------------------------ Section actions ---------------------------- */
  const createSection = useCallback((name: string, color?: string): Section | null => {
    const trimmed = name.trim() || 'New Section';
    let created: Section | null = null;
    setState((prev) => {
      if (!prev.activeNotebookId) return prev;
      const notebook = prev.notebooks.find((nb) => nb.id === prev.activeNotebookId);
      if (!notebook) return prev;

      const section = makeSection(trimmed, notebook.id, notebook.sections.length);
      if (color) section.color = color;
      const firstPage = makeNote(section.id, { title: 'New Page' });
      created = section;

      return {
        ...prev,
        notebooks: prev.notebooks.map((nb) =>
          nb.id === notebook.id ? { ...nb, sections: [...nb.sections, section] } : nb,
        ),
        notes: [...prev.notes, firstPage],
        activeSectionId: section.id,
        activePageId: firstPage.id,
      };
    });
    return created;
  }, []);

  const renameSection = useCallback((sectionId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setState((prev) => ({
      ...prev,
      notebooks: prev.notebooks.map((nb) => ({
        ...nb,
        sections: nb.sections.map((s) => (s.id === sectionId ? { ...s, name: trimmed } : s)),
      })),
    }));
  }, []);

  const setSectionColor = useCallback((sectionId: string, color: string) => {
    setState((prev) => ({
      ...prev,
      notebooks: prev.notebooks.map((nb) => ({
        ...nb,
        sections: nb.sections.map((s) => (s.id === sectionId ? { ...s, color } : s)),
      })),
    }));
  }, []);

  const deleteSection = useCallback((sectionId: string) => {
    setState((prev) => {
      let stillValid = false;
      const notebooks = prev.notebooks.map((nb) => {
        if (!nb.sections.some((s) => s.id === sectionId)) return nb;
        stillValid = true;
        return { ...nb, sections: nb.sections.filter((s) => s.id !== sectionId) };
      });
      if (!stillValid) return prev;

      const notes = prev.notes.filter((n) => n.sectionId !== sectionId);
      const owningNotebook = prev.notebooks.find((nb) =>
        nb.sections.some((s) => s.id === sectionId),
      );

      let nextSectionId = prev.activeSectionId;
      let nextPageId = prev.activePageId;
      if (prev.activeSectionId === sectionId) {
        nextSectionId = owningNotebook?.sections.find((s) => s.id !== sectionId)?.id ?? null;
        nextPageId = nextSectionId
          ? notes.filter((n) => n.sectionId === nextSectionId).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null
          : null;
      }

      return {
        ...prev,
        notebooks,
        notes,
        activeSectionId: nextSectionId,
        activePageId: nextPageId,
      };
    });
  }, []);

  /* -------------------------- Page actions ----------------------------- */
  const createPage = useCallback((overrides: Partial<Note> = {}): Note | null => {
    let created: Note | null = null;
    setState((prev) => {
      const sectionId = prev.activeSectionId;
      if (!sectionId) return prev;
      const page = makeNote(sectionId, overrides);
      created = page;
      return {
        ...prev,
        notes: [...prev.notes, page],
        activePageId: page.id,
      };
    });
    return created;
  }, []);

  const patchPage = useCallback((pageId: string, patch: Partial<Omit<Note, 'id' | 'createdAt'>>) => {
    setState((prev) => ({
      ...prev,
      notes: prev.notes.map((n) =>
        n.id === pageId ? { ...n, ...patch, updatedAt: Date.now() } : n,
      ),
    }));
  }, []);

  const updatePageContent = useCallback(
    (pageId: string, content: string) => patchPage(pageId, { content }),
    [patchPage],
  );

  const renamePage = useCallback(
    (pageId: string, title: string) => patchPage(pageId, { title: title.trim() || 'Untitled page' }),
    [patchPage],
  );

  const togglePin = useCallback((pageId: string) => {
    setState((prev) => ({
      ...prev,
      notes: prev.notes.map((n) =>
        n.id === pageId ? { ...n, pinned: !n.pinned, updatedAt: Date.now() } : n,
      ),
    }));
  }, []);

  const addTag = useCallback((pageId: string, tag: string) => {
    const normalized = tag.trim();
    if (!normalized) return;
    setState((prev) => ({
      ...prev,
      notes: prev.notes.map((n) =>
        n.id === pageId && !n.tags.includes(normalized)
          ? { ...n, tags: [...n.tags, normalized], updatedAt: Date.now() }
          : n,
      ),
    }));
  }, []);

  const removeTag = useCallback((pageId: string, tag: string) => {
    setState((prev) => ({
      ...prev,
      notes: prev.notes.map((n) =>
        n.id === pageId
          ? { ...n, tags: n.tags.filter((t) => t !== tag), updatedAt: Date.now() }
          : n,
      ),
    }));
  }, []);

  const setBackgroundStyle = useCallback(
    (pageId: string, style: BackgroundStyle) => patchPage(pageId, { backgroundStyle: style }),
    [patchPage],
  );

  const setDrawings = useCallback(
    (pageId: string, drawings: Note['drawings']) => patchPage(pageId, { drawings }),
    [patchPage],
  );

  /* ----------------------------- Search -------------------------------- */
  const searchNotes = useCallback(
    (query: string): Note[] => {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      return stateRef.current.notes
        .filter(
          (n) =>
            n.title.toLowerCase().includes(q) ||
            n.content.toLowerCase().includes(q) ||
            n.tags.some((t) => t.toLowerCase().includes(q)),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    [],
  );

  return {
    notebooks: state.notebooks,
    notes: state.notes,

    activeNotebook,
    activeSection,
    activeNote,
    activeSections,
    activeSectionNotes,
    pinnedNotes,

    activeNotebookId: state.activeNotebookId,
    activeSectionId: state.activeSectionId,
    activePageId: state.activePageId,

    selectNotebook,
    selectSection,
    selectPage,

    createNotebook,
    renameNotebook,
    deleteNotebook,

    createSection,
    renameSection,
    setSectionColor,
    deleteSection,

    createPage,
    updatePageContent,
    renamePage,
    deletePage: useCallback((pageId: string) => {
      setState((prev) => {
        const target = prev.notes.find((n) => n.id === pageId);
        if (!target) return prev;
        const notes = prev.notes.filter((n) => n.id !== pageId);
        let nextPageId = prev.activePageId;
        if (prev.activePageId === pageId) {
          nextPageId =
            notes
              .filter((n) => n.sectionId === target.sectionId)
              .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null;
        }
        return { ...prev, notes, activePageId: nextPageId };
      });
    }, []),
    togglePin,
    addTag,
    removeTag,
    setBackgroundStyle,
    setDrawings,

    searchNotes,

    stats,
    isSaving,
    lastSavedAt,
    saveNow,
  };
}

/** Re-exported for consumers building drawing toolbars. */
export type { DrawingData };
export default useNotes;
