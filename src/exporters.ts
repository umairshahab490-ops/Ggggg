/**
 * exporters.ts
 * ---------------------------------------------------------------------------
 * Phase 3 multi-format export suite for the OneNote Clone.
 *
 * Provides pure conversion helpers plus a browser download trigger:
 *   • Note HTML body  -> clean Markdown (.md)
 *   • Note HTML body  -> plain text (.txt)
 *   • Note            -> standalone, styled HTML document (.html)
 *   • Whole workspace -> JSON backup of notebooks, sections and pages (.json)
 *
 * All converters run client-side; no server round-trip is required.
 * ---------------------------------------------------------------------------
 */

import type { Note, Notebook } from './types';

/* ==========================================================================
 * Download plumbing
 * ======================================================================== */

/** MIME types used by the export ribbon. */
export type ExportMimeType = 'text/markdown' | 'text/plain' | 'text/html' | 'application/json';

/**
 * Trigger a client-side file download for generated content.
 *
 * Uses a Blob + object URL anchored to a programmatically-clicked <a>. The
 * URL is revoked on the next macrotask so large payloads do not leak.
 */
export function downloadFile(filename: string, content: string, mimeType: ExportMimeType): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Turn arbitrary user text into a safe filesystem slug. */
export function slugify(value: string, fallback = 'untitled'): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 64)
    .toLowerCase();
  return slug.length > 0 ? slug : fallback;
}

/* ==========================================================================
 * Markdown conversion (block-level tree walk)
 * ======================================================================== */

/** Escape characters that would otherwise be interpreted as Markdown syntax. */
function escapeMarkdownText(text: string): string {
  return text.replace(/([\\`*_[]])/g, '\\$1');
}

/** Convert inline formatting (bold/italic/code/links/strikethrough). */
function inlineToMarkdown(node: Node): string {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += escapeMarkdownText(child.textContent ?? '');
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const element = child as Element;
    const tag = element.tagName.toLowerCase();
    const inner = inlineToMarkdown(element);
    switch (tag) {
      case 'strong':
      case 'b':
        out += inner.trim().length > 0 ? `**${inner}**` : '';
        break;
      case 'em':
      case 'i':
        out += inner.trim().length > 0 ? `*${inner}*` : '';
        break;
      case 'u':
        out += `<u>${inner}</u>`;
        break;
      case 's':
      case 'strike':
        out += inner.trim().length > 0 ? `~~${inner}~~` : '';
        break;
      case 'code':
        out += inner.trim().length > 0 ? `\`${inner}\`` : '';
        break;
      case 'mark':
        out += inner.trim().length > 0 ? `==${inner}==` : '';
        break;
      case 'a': {
        const href = element.getAttribute('href');
        out += href && inner.trim().length > 0 ? `[${inner}](${href})` : inner;
        break;
      }
      case 'br':
        out += '  \n';
        break;
      default:
        out += inner;
    }
  });
  return out;
}

function listItemToMarkdown(li: Element, ordered: boolean, index: number): string {
  const marker = ordered ? `${index + 1}. ` : '- ';
  // Nested lists inside the item are rendered indented beneath it.
  const nestedLists = Array.from(li.querySelectorAll(':scope > ul, :scope > ol'));
  const clone = li.cloneNode(true) as Element;
  nestedLists.forEach((nested) => {
    const cloneNested = clone.querySelector(`:scope > ${nested.tagName.toLowerCase()}`);
    if (cloneNested) cloneNested.remove();
  });
  const ownText = inlineToMarkdown(clone).replace(/\s+/g, ' ').trim();
  let block = `${marker}${ownText}`;
  nestedLists.forEach((nested) => {
    const nestedOrdered = nested.tagName.toLowerCase() === 'ol';
    const nestedLines = Array.from(nested.children)
      .filter((child) => child.tagName.toLowerCase() === 'li')
      .map((child, i) => `  ${listItemToMarkdown(child as Element, nestedOrdered, i)}`);
    block += `\n${nestedLines.join('\n')}`;
  });
  return block;
}

function blockToMarkdown(element: Element): string | null {
  const tag = element.tagName.toLowerCase();
  switch (tag) {
    case 'h1':
      return `# ${inlineToMarkdown(element).trim()}`;
    case 'h2':
      return `## ${inlineToMarkdown(element).trim()}`;
    case 'h3':
      return `### ${inlineToMarkdown(element).trim()}`;
    case 'h4':
      return `#### ${inlineToMarkdown(element).trim()}`;
    case 'blockquote':
      return inlineToMarkdown(element)
        .split('\n')
        .map((line) => `> ${line.trim()}`)
        .join('\n');
    case 'pre':
      return `\`\`\`\n${(element.textContent ?? '').replace(/\n+$/, '')}\n\`\`\``;
    case 'ul':
    case 'ol': {
      const ordered = tag === 'ol';
      const items = Array.from(element.children).filter(
        (child) => child.tagName.toLowerCase() === 'li',
      );
      return items.map((item, i) => listItemToMarkdown(item as Element, ordered, i)).join('\n');
    }
    case 'hr':
      return '---';
    case 'p':
    case 'div': {
      const text = inlineToMarkdown(element).trim();
      return text.length > 0 ? text : (element.querySelector('br, img, li') ? '' : null);
    }
    default: {
      const text = inlineToMarkdown(element).trim();
      return text.length > 0 ? text : null;
    }
  }
}

/**
 * Convert a stored rich-text HTML fragment into clean Markdown.
 * Empty paragraphs collapse, blocks are separated by blank lines.
 */
export function htmlToMarkdown(html: string): string {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return html.replace(/<[^>]*>/g, '').trim();
  }
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const blocks: string[] = [];
  Array.from(parsed.body.children).forEach((child) => {
    const converted = blockToMarkdown(child);
    if (converted !== null && converted.trim().length >= 0) {
      if (converted.trim().length > 0) blocks.push(converted.trim());
    }
  });
  // Fallback: body contained only loose text nodes.
  if (blocks.length === 0) {
    const loose = (parsed.body.textContent ?? '').trim();
    if (loose.length > 0) blocks.push(loose);
  }
  return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').concat('\n');
}

/* ==========================================================================
 * Plain-text conversion
 * ======================================================================== */

/** Convert stored HTML into flowing plain text (lists keep bullets). */
export function htmlToPlainTxt(html: string): string {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  parsed.body.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  parsed.body.querySelectorAll('li').forEach((li) => li.prepend('• '));
  parsed.body.querySelectorAll('p, div, h1, h2, h3, h4, blockquote, pre, ul, ol').forEach((block) => {
    block.append('\n');
  });
  const raw = parsed.body.textContent ?? '';
  return raw.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().concat('\n');
}

/* ==========================================================================
 * Standalone HTML document export
 * ======================================================================== */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build a self-contained, styled HTML page for a single note. */
export function buildStandaloneHtmlDocument(note: Note, sectionName: string, notebookName: string): string {
  const created = new Date(note.createdAt).toLocaleString();
  const updated = new Date(note.updatedAt).toLocaleString();
  const tagList =
    note.tags.length > 0
      ? `<p class="tags">${note.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join(' ')}</p>`
      : '';
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(note.title)} — OneNote Clone</title>`,
    '<style>',
    '  body { font-family: "Segoe UI", Arial, sans-serif; background: #f3f2f1; margin: 0; padding: 32px 16px; color: #1f1f1f; }',
    '  main { max-width: 760px; margin: 0 auto; background: #fff; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,.15); padding: 40px 48px; }',
    '  h1.page-title { margin: 0 0 4px; font-size: 28px; color: #681498; }',
    '  .meta { font-size: 12px; color: #767676; margin-bottom: 16px; }',
    '  .tags { margin: 0 0 20px; }',
    '  .tag { display: inline-block; background: #f3e8fa; color: #681498; border-radius: 999px; font-size: 12px; padding: 2px 10px; margin-right: 6px; }',
    '  .content { line-height: 1.6; font-size: 15px; }',
    '  .content blockquote { border-left: 3px solid #681498; margin: 12px 0; padding: 4px 16px; color: #555; }',
    '  .content pre { background: #faf9f8; padding: 12px; border-radius: 4px; overflow-x: auto; }',
    '  footer { max-width: 760px; margin: 16px auto 0; font-size: 11px; color: #999; text-align: center; }',
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    `<h1 class="page-title">${escapeHtml(note.title)}</h1>`,
    `<p class="meta">${escapeHtml(notebookName)} › ${escapeHtml(sectionName)} · Created ${escapeHtml(created)} · Updated ${escapeHtml(updated)}</p>`,
    tagList,
    `<div class="content">${note.content}</div>`,
    '</main>',
    '<footer>Exported from OneNote Clone</footer>',
    '</body>',
    '</html>',
  ].join('\n');
}

/* ==========================================================================
 * JSON backup
 * ======================================================================== */

interface JsonBackupPayload {
  app: string;
  schemaVersion: number;
  exportedAt: string;
  notebooks: Notebook[];
  notes: Note[];
}

/** Serialize the full workspace into a versioned JSON backup document. */
export function buildJsonBackup(notebooks: Notebook[], notes: Note[]): string {
  const payload: JsonBackupPayload = {
    app: 'onenote-clone',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    notebooks,
    notes,
  };
  return JSON.stringify(payload, null, 2);
}

/* ==========================================================================
 * Filename helpers used by the ribbon
 * ======================================================================== */

export function markdownFilename(note: Note): string {
  return `${slugify(note.title)}.md`;
}

export function plainTextFilename(note: Note): string {
  return `${slugify(note.title)}.txt`;
}

export function htmlFilename(note: Note): string {
  return `${slugify(note.title)}.html`;
}

export function backupFilename(): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `onenote-backup-${stamp}.json`;
}
