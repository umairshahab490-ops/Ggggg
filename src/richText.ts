/**
 * richText.ts
 * ---------------------------------------------------------------------------
 * Shared utilities for the Phase 2 rich-text editing surface.
 *
 * The OneNote Clone stores page bodies as a restricted HTML fragment string
 * (`Note.content`). This module provides:
 *   • A whitelist-based HTML sanitizer applied on every paste/import.
 *   • Command constants + toolbar metadata for the formatting ribbon.
 *   • Selection-state introspection (active blocks / list types).
 * ---------------------------------------------------------------------------
 */

import type { ClipboardEvent } from 'react';

/* ==========================================================================
 * Sanitization
 * ======================================================================== */

/** Tags preserved by the sanitizer; everything else is unwrapped. */
const ALLOWED_TAGS = new Set([
  'p',
  'div',
  'br',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'strike',
  'sub',
  'sup',
  'mark',
  'h1',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'a',
  'span',
  'font',
]);

/** Attributes preserved globally (event handlers are always stripped). */
const GLOBAL_ALLOWED_ATTRS = new Set(['dir', 'lang', 'title']);

/** Per-tag attribute allow-list. */
const TAG_ALLOWED_ATTRS: Readonly<Record<string, Set<string>>> = {
  a: new Set(['href', 'target', 'rel']),
  font: new Set(['color', 'size', 'face']),
  span: new Set(['style']),
  ol: new Set(['start']),
};

/** URL schemes accepted on `href` attributes. */
const SAFE_URL_PREFIXES = ['http://', 'https://', 'mailto:', 'tel:', '/', '#'];

function isSafeUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('data:text/html')) return false;
  return SAFE_URL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isAllowedStyleDeclaration(declaration: string): boolean {
  const prop = declaration.split(':')[0]?.trim().toLowerCase() ?? '';
  // Only cosmetic inline styling survives — never layout/script vectors.
  return prop === 'color' || prop === 'background-color' || prop === 'font-weight';
}

function sanitizeElement(element: Element): void {
  // Strip every event handler and dangerous attribute first.
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    const allowedForTag =
      GLOBAL_ALLOWED_ATTRS.has(name) || TAG_ALLOWED_ATTRS[element.tagName.toLowerCase()]?.has(name);

    if (name.startsWith('on') || name === 'style' && !isAllowedStyle(element.getAttribute('style'))) {
      element.removeAttribute(attribute.name);
      continue;
    }
    if (!allowedForTag) {
      element.removeAttribute(attribute.name);
      continue;
    }
    if (name === 'href' && !isSafeUrl(attribute.value)) {
      element.removeAttribute(attribute.name);
    }
    if (name === 'style') {
      element.setAttribute('style', filterStyleAttribute(attribute.value));
    }
    if (name === 'target') {
      element.setAttribute('rel', 'noopener noreferrer');
    }
  }

  // Recurse into children.
  for (const child of Array.from(element.children)) {
    sanitizeElement(child);
  }
}

function isAllowedStyle(styleValue: string | null): boolean {
  if (!styleValue) return false;
  return styleValue
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .every(isAllowedStyleDeclaration);
}

function filterStyleAttribute(styleValue: string): string {
  return styleValue
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && isAllowedStyleDeclaration(part))
    .map((part) => `${part.replace(/\s*:\s*/, ': ')};`)
    .join(' ');
}

/**
 * Unwraps a disallowed element, keeping its (already-sanitized) children in
 * place so pasted content degrades gracefully instead of disappearing.
 */
function unwrapElement(element: Element): void {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }
  parent.removeChild(element);
}

/**
 * Sanitize an HTML fragment for storage/rendering inside the editor.
 * Script/style/meta objects are removed outright; unknown tags are unwrapped.
 */
export function sanitizeHtml(html: string): string {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return html;
  }
  const document$ = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const body = document$.body;

  // Remove hostile nodes entirely.
  body
    .querySelectorAll('script, style, iframe, object, embed, link, meta, form, input, textarea, select, button, svg, math')
    .forEach((node) => node.remove());

  // Depth-first pass: sanitize allowed elements, unwrap the rest.
  const walk = (node: Element): void => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase();
      if (ALLOWED_TAGS.has(tag)) {
        sanitizeElement(child);
        walk(child);
      } else {
        walk(child);
        unwrapElement(child);
      }
    }
  };
  walk(body);

  return body.innerHTML;
}

/** Extract plain text from a clipboard payload (fallback when no HTML exists). */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Highlight every case-insensitive occurrence of `query` inside `text`,
 * returning React-ready segments. Used by the Phase 3 search surfaces so
 * matched terms light up in titles and content snippets.
 */
export function highlightSegments(
  text: string,
  query: string,
): Array<{ text: string; match: boolean }> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [{ text, match: false }];
  const segments: Array<{ text: string; match: boolean }> = [];
  const haystack = text.toLowerCase();
  const needle = trimmed.toLowerCase();
  let cursor = 0;
  let found = haystack.indexOf(needle);
  while (found !== -1) {
    if (found > cursor) segments.push({ text: text.slice(cursor, found), match: false });
    segments.push({ text: text.slice(found, found + needle.length), match: true });
    cursor = found + needle.length;
    found = haystack.indexOf(needle, cursor);
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}

/**
 * Intercept a paste on the contentEditable surface and inject sanitized
 * content manually, preventing raw external markup from entering the store.
 */
export function handleSanitizedPaste(event: ClipboardEvent<HTMLElement>): void {
  const target = event.currentTarget;
  const html = event.clipboardData.getData('text/html');
  const text = event.clipboardData.getData('text/plain');

  event.preventDefault();

  let payload: string;
  if (html.trim().length > 0) {
    payload = sanitizeHtml(html);
  } else if (text.length > 0) {
    payload = escapeHtml(text).replace(/\n/g, '<br>');
  } else {
    return;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !target.contains(selection.anchorNode)) {
    target.focus();
    document.execCommand('insertHTML', false, payload);
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  const template = document.createElement('template');
  template.innerHTML = payload;
  const fragment = template.content;
  const lastNode = fragment.lastChild;
  range.insertNode(fragment);
  if (lastNode) {
    range.setStartAfter(lastNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

/* ==========================================================================
 * Toolbar model
 * ======================================================================== */

export type RichTextCommand =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikeThrough'
  | 'formatBlock'
  | 'insertOrderedList'
  | 'insertUnorderedList'
  | 'removeFormat';

/** A block format passed to `document.execCommand('formatBlock', …)`. */
export interface BlockOption {
  value: string;
  label: string;
}

export const BLOCK_OPTIONS: readonly BlockOption[] = [
  { value: 'p', label: 'Body' },
  { value: 'h1', label: 'Heading 1' },
  { value: 'h2', label: 'Heading 2' },
  { value: 'h3', label: 'Heading 3' },
  { value: 'blockquote', label: 'Quote' },
  { value: 'pre', label: 'Code block' },
];

/** Inline highlight swatches offered on the ribbon. */
export const HIGHLIGHT_COLORS: readonly string[] = [
  '#fffbd6',
  '#d5f2d5',
  '#dbeeff',
  '#ffdcec',
  '#ffe4c8',
];

/** Pen ink colors reused by both the ribbon font color and drawing canvas. */
export const INK_COLORS: readonly string[] = [
  '#1f1f1f',
  '#681498',
  '#0078d4',
  '#107c10',
  '#c17c03',
  '#d13438',
];

/**
 * Query the current selection's active block tag so the block dropdown can
 * stay in sync with the caret position.
 */
export function queryActiveBlock(): string {
  try {
    const raw = document.queryCommandValue('formatBlock');
    const normalized = raw.toLowerCase();
    if (BLOCK_OPTIONS.some((option) => option.value === normalized)) return normalized;
  } catch {
    /* queryCommandValue can throw on detached selections — ignore. */
  }
  return 'p';
}

/** Determine which list type (if any) wraps the current selection. */
export function queryActiveList(): 'none' | 'ul' | 'ol' {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return 'none';
  let node: Node | null = selection.anchorNode;
  while (node && node.nodeType !== Node.ELEMENT_NODE) {
    node = node.parentNode;
  }
  let element = node as Element | null;
  while (element && element.getAttribute('contenteditable') !== 'true') {
    const list = element.closest('ul, ol');
    if (!list) return 'none';
    if (element === list) {
      return list.tagName.toLowerCase() === 'ul' ? 'ul' : 'ol';
    }
    element = list;
    if (list.tagName.toLowerCase() === 'UL') return 'ul';
    if (list.tagName.toLowerCase() === 'OL') return 'ol';
    return 'none';
  }
  return 'none';
}

/** Convert stored rich HTML into a flat preview string for page lists. */
export function htmlToPlainText(html: string): string {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return html.replace(/<[^>]*>/g, ' ');
  }
  const document$ = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return document$.body.textContent ?? '';
}

/** True when the HTML contains no visible characters at all. */
export function isHtmlEmpty(html: string): boolean {
  const text = htmlToPlainText(html).replace(/[\s\u00a0]+/g, '');
  const hasMedia = /<(img|li|hr)\b/i.test(html);
  return text.length === 0 && !hasMedia;
}
