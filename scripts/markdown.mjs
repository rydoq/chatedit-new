/**
 * Markdown helpers for chat message content.
 *
 * Foundry v14's chat input is a ProseMirror editor, so message content arrives as HTML:
 *   - each paragraph is a <p>
 *   - Shift+Enter inserts a <br>
 *   - a second Shift+Enter in a row splits the paragraph instead (joinDoubleBreak)
 *
 * Typed text therefore maps onto that structure as: paragraph boundary = "\n\n", <br> = "\n".
 * (e.g. 4 newlines = </p><p></p><p>, 5 newlines = </p><p></p><p><br>)
 *
 * Markdown is applied *inside* each paragraph, so the paragraph/line break structure (and with it
 * all the whitespace) is never changed by the markdown conversion.
 */

const BR = /<br\b[^>]*>/gi;
const LINE_TOKEN = "CHATEDITLINEBREAK";

/** Clean up makeMd output: drop its "<!-- -->" separators and use [text](url) instead of [text](<url>). */
const tidyMd = md => md.replace(/<!-- -->/g, "").replace(/\]\(<([^>\s]*)>/g, "]($1").trim();

/** Tags that showdown can produce (or makeMd can read) as their own block, outside of a <p>. */
const BLOCK_TAGS = new Set(["P", "DIV", "UL", "OL", "BLOCKQUOTE", "PRE", "H1", "H2", "H3", "H4", "H5", "H6", "HR", "TABLE"]);

function parseFragment(html) {
  const template = document.createElement("template");
  template.innerHTML = String(html ?? "");
  return template;
}

/**
 * Render the markdown inside one paragraph's inner HTML.
 * @param {string} inner              Inner HTML of a paragraph.
 * @param {showdown.Converter} parser
 * @returns {{html: string, block: boolean}} Rendered HTML, and whether it became block content (a list, heading...).
 */
function renderParagraph(inner, parser) {
  // Leading/trailing <br>s are whitespace the user typed; keep them exactly as they are
  const [, lead, body, trail] = inner.match(/^((?:\s*<br\b[^>]*>)*)([\s\S]*?)((?:<br\b[^>]*>\s*)*)$/i);
  if (!body.trim()) return { html: inner, block: false };

  // A paragraph never contains a blank line, so showdown only sees single line breaks here
  const out = parser.makeHtml(body.replace(BR, "\n")).trim().replace(/<br\s*\/?>\n?/gi, "<br>");
  const single = out.match(/^<p>([\s\S]*)<\/p>$/i);
  if (single && !/<\/?p\b/i.test(single[1])) return { html: lead + single[1] + trail, block: false };
  return { html: out, block: true };
}

/**
 * Apply markdown to chat message HTML without touching its paragraph/line break structure.
 * @param {string} html                 Message content as produced by the chat input.
 * @param {showdown.Converter} [parser]
 * @returns {string}
 */
export function renderMarkdown(html, parser = new showdown.Converter()) {
  const template = parseFragment(html);
  const paragraphs = [...template.content.children].filter(el => el.tagName === "P");

  // Content without paragraphs (e.g. from a macro): treat the whole thing as one paragraph
  if (!paragraphs.length) return renderParagraph(String(html ?? ""), parser).html;

  for (const p of paragraphs) {
    const { html: rendered, block } = renderParagraph(p.innerHTML, parser);
    if (block) p.outerHTML = rendered;
    else p.innerHTML = rendered;
  }
  return template.innerHTML;
}

/**
 * Convert inline HTML (the inside of a paragraph) to markdown, with every <br> as a "\n".
 * @param {string} inner
 * @param {showdown.Converter} parser
 */
function inlineToMarkdown(inner, parser) {
  if (!inner.replace(BR, "").trim()) return inner.replace(BR, LINE_TOKEN).trim().replaceAll(LINE_TOKEN, "\n");
  // makeMd mangles <br>s and whitespace, so swap them for a placeholder it leaves alone
  return tidyMd(parser.makeMd(inner.replace(/\s*<br\b[^>]*>\s*/gi, LINE_TOKEN))).replaceAll(LINE_TOKEN, "\n");
}

/**
 * Convert stored chat message HTML into the markdown text shown in the edit form.
 * @param {string} html
 * @param {showdown.Converter} [parser]
 * @returns {string}
 */
export function htmlToMarkdown(html, parser = new showdown.Converter()) {
  if (!html) return "";
  const parts = [];
  let loose = "";   // top-level inline content that isn't wrapped in a <p>
  const flushLoose = () => {
    if (loose.trim()) parts.push(inlineToMarkdown(loose, parser));
    loose = "";
  };

  for (const node of parseFragment(html).content.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent.trim()) loose += node.textContent;
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    if (node.tagName === "P") {
      flushLoose();
      parts.push(inlineToMarkdown(node.innerHTML, parser));
    } else if (BLOCK_TAGS.has(node.tagName)) {
      flushLoose();
      parts.push(tidyMd(parser.makeMd(node.outerHTML)));
    } else {
      loose += node.outerHTML;
    }
  }
  flushLoose();

  // One paragraph boundary = one blank line, exactly like Shift+Enter twice in the chat input
  return parts.join("\n\n");
}

/**
 * Convert the edit form's markdown text back into chat message HTML.
 * This is the inverse of htmlToMarkdown, followed by the same rendering a new message gets.
 * @param {string} text
 * @param {showdown.Converter} [parser]
 * @returns {string}
 */
export function markdownToHtml(text, parser = new showdown.Converter()) {
  if (!text) return "";
  const html = String(text)
    .replace(/\r\n?/g, "\n")
    .split("\n\n")
    .map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return renderMarkdown(html, parser);
}
