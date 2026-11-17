// Part of Canela, a live Markdown editor in Hilde.
//
// SPDX-FileCopyrightText: 2026 Heiko Zimmermann
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
// The HTML mode drawn as the page it makes: each block of the cleaned
// source (one block a line, from Wolly.HtmlParts) is parsed by the browser
// and shown; every text node of it is matched to its run of text in the
// source, so a place in the drawing is a byte of the source and back.  The
// edits a person makes in the drawing (typing, Backspace, Return, formats)
// become edits of the source that keep its tags whole.

const decoder = new TextDecoder();
const encoder = new TextEncoder();
// The elements an empty one of which still takes the caret: they hold
// text.  An empty div, a or span is decoration (a spacer, a rule, an
// anchor) and no place to type into.
const TEXT_HOLDERS = new Set(["p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "blockquote", "pre", "dd", "dt", "figcaption"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr"]);
const NAMED = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0" };

function entity(body) {
  if (body[0] === "#") {
    const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : null;
  }
  // Own keys only: "&constructor;" is no entity, not Object's constructor.
  if (Object.hasOwn(NAMED, body)) return NAMED[body];
  const t = document.createElement("textarea");
  t.innerHTML = "&" + body + ";";
  return t.value === "&" + body + ";" ? null : t.value;
}

// The runs of text between the tags of source[start, stop): their decoded
// text and, for every place 0..length of that text (UTF-16), the byte of
// the source it stands at.  Text inside a tag, a comment or a raw element
// (script, style; the cleaner keeps none) is no run.
export function textRuns(source, start, stop) {
  const runs = [];
  let i = start;
  let text = "";
  let offs = [];
  let runStart = start;
  const flush = (at) => {
    if (text.length > 0) {
      offs.push(at);
      runs.push({ start: runStart, stop: at, text, offs });
    }
    text = "";
    offs = [];
  };
  let opened = false;
  while (i < stop) {
    const b = source[i];
    if (b === 60) { // <
      flush(i);
      // An element with nothing inside (<li></li>) still takes the caret:
      // an empty run where its end tag starts.
      if (opened && source[i + 1] === 47) runs.push({ start: i, stop: i, text: "", offs: [i], empty: true });
      opened = false;
      let j = i + 1;
      const tagName = /^[a-zA-Z][a-zA-Z0-9]*/.exec(decoder.decode(source.slice(i + 1, Math.min(i + 12, stop))));
      if (source[j] === 33 && source[j + 1] === 45 && source[j + 2] === 45) {
        while (j < stop && !(source[j] === 62 && source[j - 1] === 45 && source[j - 2] === 45)) j++;
      } else {
        let quote = 0;
        while (j < stop && (quote !== 0 || source[j] !== 62)) {
          if (quote === 0 && (source[j] === 34 || source[j] === 39)) quote = source[j];
          else if (quote !== 0 && source[j] === quote) quote = 0;
          j++;
        }
      }
      opened = tagName !== null && TEXT_HOLDERS.has(tagName[0].toLowerCase()) && source[j - 1] !== 47;
      i = Math.min(j + 1, stop);
      runStart = i;
      continue;
    }
    opened = false;
    if (text.length === 0) runStart = i;
    if (b === 38) { // &
      let j = i + 1;
      while (j < stop && j - i < 32 && source[j] !== 59 && source[j] !== 60 && source[j] !== 38) j++;
      const body = source[j] === 59 ? decoder.decode(source.slice(i + 1, j)) : null;
      const ch = body ? entity(body) : null;
      if (ch !== null) {
        for (let k = 0; k < ch.length; k++) offs.push(i);
        text += ch;
        i = j + 1;
        continue;
      }
    }
    let n = 1;
    if (b >= 0xf0) n = 4; else if (b >= 0xe0) n = 3; else if (b >= 0xc0) n = 2;
    const ch = decoder.decode(source.slice(i, i + n));
    for (let k = 0; k < ch.length; k++) offs.push(i);
    text += ch;
    i += n;
  }
  flush(i);
  return runs;
}

// HTML with every named entity but the five of XML written as its
// character.  The cleaner of the core knows only those five and writes any
// other as text (&uuml; became &amp;uuml;, measured on a stored legal
// notice); the characters themselves are UTF-8 and need no entity.
const XML_ENTITIES = new Set(["amp", "lt", "gt", "quot", "apos"]);
export function plainEntities(html) {
  if (!html) return html;
  return html.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (all, name) => {
    if (XML_ENTITIES.has(name)) return all;
    const ch = entity(name);
    if (ch === null || "&<>\"'".includes(ch)) return all;
    return ch;
  });
}

// Escapes text so that it stays text in HTML.
export function escapeText(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeAttribute(text) {
  return escapeText(text).replace(/"/g, "&quot;");
}

// The element of block from the cleaned source: the browser parses the
// block, and every text node that matches the next run of the source gets
// spans with the byte it starts at (data-s) and, through places, the byte
// of each of its characters.
export function drawHtmlBlock(source, block, index, from, to, head, places, caret) {
  const el = document.createElement("div");
  el.className = "canela-block canela-htmlblock";
  el.dataset.b = index;
  el.dataset.e = block.stop;
  const runs = textRuns(source, block.start, block.stop);
  // Empty elements get a placeholder span at their empty run, the caret's
  // place when it stands there and the target of a click into them.
  let html = "";
  let last = block.start;
  for (const run of runs) {
    if (!run.empty) continue;
    html += decoder.decode(source.slice(last, run.start)) + "<span data-empty=\"" + run.start + "\"></span>";
    last = run.start;
  }
  html += decoder.decode(source.slice(last, block.stop));
  const template = document.createElement("template");
  template.innerHTML = html;
  // The content's own id, name and canela-* classes are the page's on the
  // published page; in the editor they would clash with the editor's own
  // elements (the caret is found as .canela-caret) and name window globals.
  for (const x of template.content.querySelectorAll("[id], [name], [class*='canela-']")) {
    x.removeAttribute("id");
    x.removeAttribute("name");
    for (const c of [...x.classList]) if (c.startsWith("canela-")) x.classList.remove(c);
  }
  el.append(template.content);
  for (const a of el.querySelectorAll("a")) a.addEventListener("click", (ev) => ev.preventDefault());
  for (const p of el.querySelectorAll("span[data-empty]")) {
    p.dataset.s = p.dataset.empty;
    p.textContent = "\u200b";
    places.set(p, [Number(p.dataset.empty), Number(p.dataset.empty)]);
    if (Number(p.dataset.empty) === head) p.before(caret());
  }
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  let r = 0;
  let caretDrawn = false;
  for (const node of nodes) {
    let k = r;
    while (k < runs.length && runs[k].text !== node.data) k++;
    if (k >= runs.length) continue;
    r = k + 1;
    const run = runs[k];
    const cuts = new Set([0, run.text.length]);
    for (let c = 0; c <= run.text.length; c++) {
      const at = run.offs[c];
      if (at === from || at === to || at === head) cuts.add(c);
    }
    const points = [...cuts].sort((x, y) => x - y);
    const frag = document.createDocumentFragment();
    for (let p = 0; p < points.length; p++) {
      const i = points[p];
      const j = p + 1 < points.length ? points[p + 1] : i;
      const caretHere = !caretDrawn && run.offs[i] === head;
      if (caretHere) caretDrawn = true;
      if (j <= i) { if (caretHere) frag.append(caret()); continue; }
      const seg = document.createElement("span");
      seg.dataset.s = run.offs[i];
      seg.textContent = run.text.slice(i, j);
      places.set(seg, run.offs.slice(i, j + 1));
      if (run.offs[i] >= from && run.offs[j] <= to && from < to) seg.classList.add("canela-selected");
      // The caret inside the text after it, so that it wraps with that text
      // (beside it, it stayed at the end of the line above a wrap).
      if (caretHere) seg.prepend(caret());
      frag.append(seg);
    }
    node.replaceWith(frag);
  }
  if (!caretDrawn && head >= block.start && head <= block.stop && runs.length === 0) {
    const target = el.querySelector("p, li, h1, h2, h3, h4, h5, h6, td, th, div") || el;
    target.append(caret());
  }
  return el;
}

// Whether a run is only the blanks and line feeds that lay out the source
// between tags: it shows nothing, and a caret there would stand on nothing
// (measured on a stored legal notice: six presses of an arrow between two
// headings).  A run of blanks alone stays a place: between two inline
// elements it is a visible space.
function layoutSpace(run) {
  return !run.empty && /\n/.test(run.text) && /^\s*$/.test(run.text);
}

// Every place the caret may stand in the HTML mode, in order: each
// character boundary of every run, and the content of a block without text.
export function caretPlaces(source, blocks) {
  const all = [];
  for (const block of blocks) {
    const runs = textRuns(source, block.start, block.stop).filter((r) => !layoutSpace(r));
    // A block without text takes the caret only when it is an element that
    // holds text (an empty paragraph), not a decoration (<a></a>, a spacer).
    if (runs.length === 0 && TEXT_HOLDERS.has(simpleTag(source, block) || "")) {
      all.push({ at: block.content, block, run: null, k: 0 });
    }
    for (const run of runs) {
      for (let k = 0; k <= run.text.length; k++) {
        if (k > 0 && k < run.text.length && run.offs[k] === run.offs[k - 1]) continue;
        all.push({ at: run.offs[k], block, run, k });
      }
    }
  }
  if (all.length === 0 && blocks.length > 0) all.push({ at: blocks[0].content, block: blocks[0], run: null, k: 0 });
  return all;
}

// Every caret place of a whole source, as bytes in order.
export function textPlaces(source) {
  const all = [];
  for (const run of textRuns(source, 0, source.length)) {
    if (layoutSpace(run)) continue;
    for (let k = 0; k <= run.text.length; k++) {
      if (k > 0 && k < run.text.length && run.offs[k] === run.offs[k - 1]) continue;
      all.push(run.offs[k]);
    }
  }
  return all;
}

// The name of the element a block opens with, when the block is one element
// whose content lies between its tags (a paragraph, a heading, an item).
export function simpleTag(source, block) {
  if (block.contentStop >= block.stop || block.content <= block.start) return null;
  const head = decoder.decode(source.slice(block.start, block.content));
  const m = /^\s*<([a-zA-Z][a-zA-Z0-9]*)/.exec(head);
  return m ? m[1].toLowerCase() : null;
}

export function bytes(text) {
  return encoder.encode(text);
}
