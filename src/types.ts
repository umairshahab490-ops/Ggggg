/**
 * types.ts
 * ---------------------------------------------------------------------------
 * Core domain models for the OneNote Clone application.
 *
 * The hierarchy mirrors Microsoft OneNote:
 *   Notebook  ->  Section[]  ->  Note (Page)[]
 *
 * Every entity is identified by a stable, generated string id so records can
 * be safely persisted to (and rehydrated from) localStorage.
 * ---------------------------------------------------------------------------
 */

/**
 * Visual page background styles supported by the note canvas, matching
 * OneNote's ruled/grid paper options.
 */
export type BackgroundStyle = 'plain' | 'lined' | 'grid';

/**
 * A single stroke captured by the freehand drawing layer of a page.
 *
 * Coordinates are normalized device-independent pixel positions relative to
 * the page canvas surface. Strokes are stored as plain data (never as image
 * blobs) so they remain editable, serializable, and diff-friendly.
 */
export interface DrawingStroke {
  /** Unique identifier for the stroke within its parent note. */
  id: string;
  /** Ordered list of points sampled along the pen path. */
  points: Array<{ x: number; y: number }>;
  /** CSS color string applied to the stroke (e.g. "#681498"). */
  color: string;
  /** Stroke width in pixels. */
  width: number;
  /** Opacity from 0 (invisible) to 1 (fully opaque). */
  opacity: number;
  /** Tool used to produce the stroke. */
  tool: 'pen' | 'pencil' | 'highlighter' | 'eraser';
}

/**
 * Structured container for all ink/drawing data attached to a note.
 *
 * `Note.drawings` may hold either an opaque serialized string (legacy or
 * third-party canvas payloads) or this strongly-typed structure produced by
 * the built-in drawing toolbar.
 */
export interface DrawingData {
  /** All strokes rendered on the page, in paint order. */
  strokes: DrawingStroke[];
  /** Optional base64-encoded PNG snapshot of a flattened render. */
  flattenedImage?: string | null;
  /** Canvas dimensions the strokes were captured against. */
  size: { width: number; height: number };
}

/**
 * Union accepted by `Note.drawings`: raw serialized string data or the
 * structured stroke model described above.
 */
export type NoteDrawings = string | DrawingData;

/**
 * A notebook page — the atomic unit of user content.
 */
export interface Note {
  /** Stable unique identifier (UUID-like). */
  id: string;
  /** Human-readable page title shown on tabs and page lists. */
  title: string;
  /** Page body. Stored as plain text / HTML-rich string content. */
  content: string;
  /** Id of the `Section` that owns this page. */
  sectionId: string;
  /** Creation timestamp (epoch milliseconds). */
  createdAt: number;
  /** Last-modified timestamp (epoch milliseconds). */
  updatedAt: number;
  /** Whether the page appears in the "Pinned" quick-access area. */
  pinned: boolean;
  /** User-assigned labels, e.g. ["Important", "To-Do"]. */
  tags: string[];
  /** Paper background rendering for the page canvas. */
  backgroundStyle: BackgroundStyle;
  /** Freehand ink layers, either serialized or structured. Empty string when none. */
  drawings: NoteDrawings;
}

/**
 * A named group of pages inside a notebook. Sections render as the second
 * navigation column and carry an accent color for visual scanning.
 */
export interface Section {
  /** Stable unique identifier (UUID-like). */
  id: string;
  /** Display name of the section. */
  name: string;
  /** Accent color as a CSS hex string (e.g. "#681498"). */
  color: string;
  /** Id of the parent `Notebook`. */
  notebookId: string;
}

/**
 * Top-level container holding sections (and, transitively, pages).
 *
 * `sections` is kept embedded for convenience/serialization; the hook
 * maintains referential integrity between notebooks, sections, and notes.
 */
export interface Notebook {
  /** Stable unique identifier (UUID-like). */
  id: string;
  /** Display name of the notebook. */
  name: string;
  /** Ordered list of sections belonging to this notebook. */
  sections: Section[];
}

/**
 * Live editing statistics derived from the active note's content.
 */
export interface TextStatistics {
  /** Total whitespace-delimited words. */
  wordCount: number;
  /** Total characters, including whitespace. */
  characterCount: number;
  /** Characters excluding whitespace. */
  characterCountNoSpaces: number;
  /** Newline-delimited lines (empty document reports 0). */
  lineCount: number;
  /** Estimated reading time in whole minutes (~200 wpm). */
  readingTimeMinutes: number;
}

/**
 * Shape persisted to localStorage by the `useNotes` hook.
 */
export interface NotesState {
  notebooks: Notebook[];
  notes: Note[];
  activeNotebookId: string | null;
  activeSectionId: string | null;
  activePageId: string | null;
}

/** Well-known localStorage key used for persistence. */
export const NOTES_STORAGE_KEY = 'onenote-clone:state:v1';

/** Default accent palette cycled when creating new sections. */
export const SECTION_PALETTE: readonly string[] = [
  '#681498', // OneNote purple
  '#c17c03', // amber
  '#107c10', // green
  '#0078d4', // blue
  '#d13438', // red
  '#00b7c3', // teal
  '#8764b8', // lavender
  '#498205', // olive
];

/** Tag suggestions surfaced in the tagging UI. */
export const DEFAULT_TAGS: readonly string[] = [
  'Important',
  'Question',
  'To-Do',
  'Idea',
  'Follow Up',
  'Personal',
];

/**
 * A user-manageable, color-coded label (Phase 3 Tag Manager).
 *
 * The palette defaults cover the classic OneNote indicator colors; users can
 * create additional custom tags with any hex color. Notes reference tags by
 * their display `name` (`Note.tags`), so `TagDefinition.name` is the join key.
 */
export interface TagDefinition {
  /** Stable unique identifier (UUID-like). */
  id: string;
  /** Display name shown on chips and filters (e.g. "Important"). */
  name: string;
  /** Chip background color as a CSS hex string (e.g. "#d13438"). */
  color: string;
}

/** Well-known localStorage key for the tag registry. */
export const TAGS_STORAGE_KEY = 'onenote-clone:tags:v1';

/** Seed registry matching `DEFAULT_TAGS`, each with an indicator color. */
export const DEFAULT_TAG_DEFINITIONS: readonly TagDefinition[] = [
  { id: 'tag_important', name: 'Important', color: '#d13438' },
  { id: 'tag_question', name: 'Question', color: '#0078d4' },
  { id: 'tag_todo', name: 'To-Do', color: '#681498' },
  { id: 'tag_idea', name: 'Idea', color: '#c17c03' },
  { id: 'tag_followup', name: 'Follow Up', color: '#107c10' },
  { id: 'tag_personal', name: 'Personal', color: '#00b7c3' },
];

/** Colors cycled when the user creates a brand-new custom tag. */
export const TAG_COLOR_PALETTE: readonly string[] = [
  '#681498',
  '#d13438',
  '#0078d4',
  '#107c10',
  '#c17c03',
  '#00b7c3',
  '#8764b8',
  '#498205',
];
