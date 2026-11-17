// Part of Canela, a live Markdown editor in Hilde.
//
// SPDX-FileCopyrightText: 2026 Heiko Zimmermann
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
// Canela on a web page: the editor of canela.wasm drawn into the DOM.
//
//     import { Canela } from "./canela.js";
//     const editor = await Canela.create(document.querySelector("#content"), {
//       wasm: "/js/canela/canela.wasm",   // where canela.wasm lies
//       mode: "markdown",                 // or "html" (source of HTML), "plain"
//       input: "html", output: "html",    // what the host gives and takes
//       toolbar: ["heading", "bold", "italic", "link", "bulletedList", "image", "undo", "redo"],
//       locale: "de",
//       upload: async (file, name) => "/images/uploads/name.png",  // stores, answers the URL
//       onChange: (editor) => {},
//     });
//     editor.getData(); editor.setData(html); editor.destroy();
//
// The core keeps nothing between calls: this file holds the source (UTF-8
// bytes) and the selection, hands both to every call and takes the new ones
// back.  Every rule of editing (Return in a list, Backspace at a prefix, the
// markers a cursor shows) is the core's; this file draws and routes keys.

import { loadHilde } from "./hilde-wasm.js";
import { drawHtmlBlock, caretPlaces, textPlaces, simpleTag, escapeText, escapeAttribute, plainEntities } from "./html-view.js";
import { cleanPastedHtml } from "./paste-clean.js";
import { icon } from "./icons.js";

const MODES = { markdown: 0, html: 1, plain: 2 };
const OP = {
  none: 0, type: 1, ret: 2, shiftRet: 3, back: 4, del: 5, heading: 6, task: 7,
  left: 8, right: 9, lineStart: 10, lineEnd: 11, word: 12, line: 13, all: 14, paste: 15,
  command: 16, table: 17, cell: 18, changeTable: 19, replaceAll: 20,
};
// Toolbar names (those of CKEditor, so a host keeps its configuration) and
// the English names of the core's commands.
const FORMATS = {
  bold: "Bold", italic: "Italic", code: "Inline code", strikethrough: "Strikethrough",
  highlight: "Highlight", bulletedList: "Bullet list", numberedList: "Numbered list",
  todoList: "Task", blockQuote: "Quote", codeBlock: "Code block", horizontalLine: "Horizontal rule",
};
const TABLE_TOOLS = ["Add Row Below", "Add Column Right", "Delete Row", "Delete Column",
  "Align Column Left", "Align Column Center", "Align Column Right"];
const BLOCK = ["paragraph", "heading", "quote", "bullet", "ordered", "task", "fence", "mermaid",
  "rule", "table", "html", "definition", "toc", "frontmatter", "empty"];
const SPAN = ["em", "strong", "strike", "code", "link", "image", "autolink", "barelink", "html",
  "escape", "entity", "footnote", "emoji", "sub", "sup", "mark", "math", "note"];
const MOST_UNDO = 1000;

const TEXTS = {
  en: {
    label: "Editor", paragraph: "Paragraph", heading: "Heading", bold: "Bold", italic: "Italic",
    strikethrough: "Strikethrough", code: "Code", link: "Link", bulletedList: "Bulleted list",
    numberedList: "Numbered list", todoList: "To-do list", blockQuote: "Quote", codeBlock: "Code block",
    insertTable: "Table", horizontalLine: "Horizontal line", image: "Picture", undo: "Undo",
    redo: "Redo", linkAsk: "Address of the link", preview: "shown text", uploadFailed: "The picture was not stored", badAnswer: "the server did not answer the address of a picture", pictureName: "Name of the picture (file name and description)",
    words: "words", characters: "characters", sourceEditing: "Source", viewMode: "View: Markdown or HTML", viewMarkdown: "Markdown", viewHtml: "HTML",
  },
  de: {
    label: "Editor", paragraph: "Absatz", heading: "Überschrift", bold: "Fett", italic: "Kursiv",
    strikethrough: "Durchgestrichen", code: "Code", link: "Link", bulletedList: "Aufzählung",
    numberedList: "Nummerierte Liste", todoList: "Aufgabenliste", blockQuote: "Zitat",
    codeBlock: "Codeblock", insertTable: "Tabelle", horizontalLine: "Trennlinie", image: "Bild",
    undo: "Rückgängig", redo: "Wiederholen", linkAsk: "Adresse des Links", preview: "angezeigter Text",
    uploadFailed: "Das Bild wurde nicht gespeichert", badAnswer: "der Server gab keine Adresse eines Bildes zurück", pictureName: "Name des Bildes (Dateiname und Beschreibung)", words: "Wörter", characters: "Zeichen",
    sourceEditing: "Quelltext", viewMode: "Ansicht: Markdown oder HTML", viewMarkdown: "Markdown", viewHtml: "HTML",
  },
};

const DEFAULT_TOOLBAR = ["heading", "|", "bold", "italic", "strikethrough", "code", "link", "|",
  "bulletedList", "numberedList", "todoList", "blockQuote", "codeBlock", "insertTable",
  "horizontalLine", "image", "|", "undo", "redo", "sourceEditing", "viewMode"];

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const modules = new Map();

// One instance of canela.wasm per URL, shared by every editor of the page:
// the module keeps no state between calls.
async function core(url) {
  if (!modules.has(url)) {
    modules.set(url, (async () => loadHilde(await (await fetch(url)).arrayBuffer()))());
  }
  return modules.get(url);
}

// Calls an export that writes its answer into an out span: a first try with
// a guess, a second with the length the module asked for.
function call(hilde, fn, inputs, numbers, guess) {
  const e = hilde.exports;
  const mem = () => new Uint8Array(e.memory.buffer);
  const placed = inputs.map((bytes) => {
    const address = bytes.length > 0 ? e.hilde_wasm_alloc(bytes.length) : e.hilde_wasm_alloc(1);
    if (address === 0) throw new Error("canela: no memory for " + bytes.length + " bytes");
    mem().set(bytes, address);
    return { address, length: bytes.length };
  });
  let room = Math.max(guess, 64);
  try {
    for (let round = 0; round < 2; round++) {
      const out = e.hilde_wasm_alloc(room);
      if (out === 0) throw new Error("canela: no memory for " + room + " bytes");
      try {
        const size = fn(placed, numbers, out, room) >>> 0;
        if (size <= room) return mem().slice(out, out + size);
        room = size;
      } finally {
        e.hilde_wasm_free(out);
      }
    }
    throw new Error("canela: the answer grew between two calls");
  } finally {
    for (const p of placed) e.hilde_wasm_free(p.address);
  }
}

function words(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return (i) => view.getUint32(i * 4, true);
}

class Editor {
  constructor(hilde, host, options) {
    this.hilde = hilde;
    this.host = host;
    this.options = options;
    this.mode = MODES[options.mode] ?? 0;
    this.texts = TEXTS[(options.locale || navigator.language || "en").slice(0, 2)] || TEXTS.en;
    this.source = new Uint8Array(0);
    this.anchor = 0;
    this.head = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.lastGroup = null;
    this.goalX = null;
    this.german = this.texts === TEXTS.de;
    this.commands = this.loadCommands();
    this.build();
  }

  // The core's table of commands, with the English name to find a command
  // by and the name in the language of the page to show.
  loadCommands() {
    const read = (german) => {
      const bytes = call(this.hilde, (p, n, out, room) => this.hilde.exports.canela_commands(german, out, room),
        [], [], 4096);
      const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let at = 0;
      const word = () => { const x = v.getUint32(at, true); at += 4; return x; };
      const text = () => { const n = word(); const s = decoder.decode(bytes.slice(at, at + n)); at += n; return s; };
      const list = [];
      for (let id = 0, count = word(); id < count; id++) {
        list.push({ id, kind: word(), style: word(), name: text(), syntax: text(), shortcut: text() });
      }
      return list;
    };
    const english = read(0);
    const shown = this.german ? read(1) : english;
    return english.map((c, i) => ({ ...c, english: c.name, name: shown[i].name }));
  }

  label(item) {
    const english = Object.hasOwn(FORMATS, item) ? FORMATS[item] : item === "link" ? "Link" : item === "insertTable" ? "Table"
      : item === "image" ? "Image" : item === "undo" ? "Undo" : item === "redo" ? "Redo" : null;
    const c = english && this.commands.find((k) => k.english === english);
    return c ? c.name : this.texts[item] || item;
  }

  // ---- calls of the core ----

  edit(op, number = 0, first = "", second = "") {
    const f = typeof first === "string" ? encoder.encode(first) : first;
    const s = typeof second === "string" ? encoder.encode(second) : second;
    const bytes = call(this.hilde, (p, n, out, room) => this.hilde.exports.canela_edit(
      this.mode, p[0].address, p[0].length, this.anchor, this.head, op, number,
      p[1].address, p[1].length, p[2].address, p[2].length, out, room),
    [this.source, f, s], [], this.source.length + f.length + s.length + 64);
    const w = words(bytes);
    return { anchor: w(0), head: w(1), source: bytes.slice(8) };
  }

  layout() {
    const bytes = call(this.hilde, (p, n, out, room) => this.hilde.exports.canela_layout(
      this.mode, p[0].address, p[0].length, this.anchor, this.head, out, room),
    [this.source], [], this.source.length * 8 + 256);
    const w = words(bytes);
    const blocks = [];
    let i = 1;
    for (let b = 0, count = w(0); b < count; b++) {
      const block = { kind: BLOCK[w(i)], start: w(i + 1), stop: w(i + 2), content: w(i + 3),
        contentStop: w(i + 4), level: w(i + 5), number: w(i + 6), checked: w(i + 7) === 1, spans: [] };
      const spans = w(i + 8);
      i += 9;
      for (let s = 0; s < spans; s++, i += 7) {
        block.spans.push({ kind: SPAN[w(i)], start: w(i + 1), stop: w(i + 2), innerStart: w(i + 3),
          innerStop: w(i + 4), parent: w(i + 5), shown: w(i + 6) === 1 });
      }
      blocks.push(block);
    }
    return blocks;
  }

  toHtml() {
    return decoder.decode(call(this.hilde, (p, n, out, room) => this.hilde.exports.canela_to_html(
      this.mode, p[0].address, p[0].length, out, room), [this.source], [], this.source.length * 2 + 256));
  }

  fromHtml(html) {
    const bytes = encoder.encode(plainEntities(html));
    return call(this.hilde, (p, n, out, room) => this.hilde.exports.canela_from_html(
      this.mode, p[0].address, p[0].length, out, room), [bytes], [], bytes.length + 256);
  }

  // ---- the host's side ----

  getData() {
    const output = this.options.output || "html";
    if (output === "html" && this.mode !== MODES.plain) return this.toHtml();
    return decoder.decode(this.source);
  }

  setData(data) {
    const input = this.options.input || "html";
    if (this.options.mode === "auto" && input === "html") {
      this.mode = this.markdownKeeps(data || "") ? MODES.markdown : MODES.html;
      this.root.dataset.mode = this.mode === MODES.markdown ? "markdown" : "html";
    }
    if (input === "html" && this.mode !== MODES.plain) {
      this.source = this.fromHtml(data || "");
    } else {
      this.source = encoder.encode(data || "");
    }
    this.anchor = this.head = 0;
    const normal = this.edit(OP.none);
    this.source = normal.source;
    this.undoStack = [];
    this.redoStack = [];
    this.render();
  }

  // Whether html comes out of the Markdown mode as the HTML mode gives it:
  // then nothing of it is lost in Markdown (no layout classes, divs,
  // styles).  Measured over the stored pages of a CMS.
  markdownKeeps(html) {
    const keep = this.mode;
    const shape = (h) => h.replace(/\s+/g, "").replace(/rel="[^"]*"/g, "").replace(/<\/?(thead|tbody)>/g, "");
    try {
      this.mode = MODES.markdown;
      const viaMd = shape(this.htmlOf(this.fromHtml(html)));
      this.mode = MODES.html;
      const viaHtml = shape(this.htmlOf(this.fromHtml(html)));
      return viaMd === viaHtml;
    } finally {
      this.mode = keep;
    }
  }

  htmlOf(source) {
    return decoder.decode(call(this.hilde, (p, n, out, room) => this.hilde.exports.canela_to_html(
      this.mode, p[0].address, p[0].length, out, room), [source], [], source.length * 2 + 256));
  }

  getMarkdown() {
    return decoder.decode(this.source);
  }

  destroy() {
    this.root.remove();
    if (this.textarea) {
      this.textarea.value = this.getData();
      this.textarea.style.display = this.textareaDisplay;
    }
  }

  // ---- edits ----

  // An edit through the core, kept for undo; typing and Backspace in a row
  // go back as one step, as in the native Canela.
  apply(op, number, first, second) {
    const group = op === OP.type && first.length === 1 && first !== " " ? "type"
      : op === OP.back ? "back" : null;
    const moves = op >= OP.left && op <= OP.all;
    if (!moves && !(group && group === this.lastGroup)) {
      this.undoStack.push({ source: this.source, anchor: this.anchor, head: this.head });
      if (this.undoStack.length > MOST_UNDO) this.undoStack.shift();
    }
    if (!moves) this.redoStack = [];
    this.lastGroup = moves ? null : group;
    let r = this.edit(op, number, first, second);
    if (this.mode === MODES.html && !moves) r = this.normalHtml(r);
    const changed = !moves && !equalBytes(r.source, this.source);
    this.source = r.source;
    this.anchor = r.anchor;
    this.head = r.head;
    this.render();
    if (changed) this.changed();
  }

  undo() {
    const step = this.undoStack.pop();
    if (!step) return;
    this.redoStack.push({ source: this.source, anchor: this.anchor, head: this.head });
    Object.assign(this, step);
    this.lastGroup = null;
    this.render();
    this.changed();
  }

  redo() {
    const step = this.redoStack.pop();
    if (!step) return;
    this.undoStack.push({ source: this.source, anchor: this.anchor, head: this.head });
    Object.assign(this, step);
    this.lastGroup = null;
    this.render();
    this.changed();
  }

  changed() {
    if (this.textarea) this.textarea.value = this.getData();
    if (this.options.onChange) this.options.onChange(this);
  }

  select(anchor, head) {
    this.anchor = anchor;
    this.head = head;
    this.lastGroup = null;
    this.render();
  }

  selectedBytes() {
    const a = Math.min(this.anchor, this.head);
    const b = Math.max(this.anchor, this.head);
    return this.source.slice(a, b);
  }

  // Switches the view between Markdown and the drawn HTML.  The content goes
  // over as HTML, the form it is stored in, so the switch changes how it is
  // edited, not what is kept; Markdown loses what it cannot hold (classes,
  // styles), which is why "auto" opened such content as HTML.  Undo starts anew.
  switchView() {
    if (this.mode === MODES.plain) return;
    const html = this.toHtml();
    this.mode = this.mode === MODES.markdown ? MODES.html : MODES.markdown;
    this.raw = false;
    this.source = this.fromHtml(html);
    this.anchor = this.head = 0;
    this.source = this.edit(OP.none).source;
    this.undoStack = [];
    this.redoStack = [];
    this.render();
    this.changed();
  }

  // A format of the core's table of commands, by its English name.
  format(name) {
    const c = this.commands.find((k) => k.english === name);
    if (c) this.apply(OP.command, c.id);
  }

  inTable() {
    const e = this.hilde.exports;
    const n = this.source.length;
    const a = e.hilde_wasm_alloc(Math.max(n, 1));
    new Uint8Array(e.memory.buffer).set(this.source, a);
    const found = e.canela_in_table(this.mode, a, n, this.anchor, this.head);
    e.hilde_wasm_free(a);
    return found === 1;
  }

  blockAtCursor() {
    const blocks = this.layoutCache || this.layout();
    return blocks.find((b) => this.head >= b.start && this.head <= b.stop) || blocks[blocks.length - 1];
  }

  async insertPicture(file) {
    if (!this.options.upload) return;
    // The picture's name: its file name on the site (search engines read it)
    // and its alternative text; offered from the file's own name.
    const offered = (file.name || "").replace(/\.[^.]*$/, "").replace(/[-_]+/g, " ").trim();
    const given = prompt(this.texts.pictureName, offered);
    if (given === null) return;
    const alt = (given.trim() || offered).replace(/[\[\]<>"]/g, "");
    try {
      const url = await this.options.upload(file, alt);
      // The host's answer goes into the source: only a path of this site,
      // http(s) or a blob of this page, with nothing that ends the Markdown
      // link or the attribute.
      if (typeof url !== "string" || !/^(\/(?!\/)|https?:\/\/|blob:)[^\s()<>"'\\]+$/i.test(url)) {
        throw new Error(this.texts.badAnswer);
      }
      if (this.htmlView()) this.apply(OP.type, 0, "<img src=\"" + escapeAttribute(url) + "\" alt=\"" + escapeAttribute(alt) + "\">");
      else this.apply(OP.type, 0, "![" + alt + "](" + url + ")");
    } catch (err) {
      this.status.textContent = this.texts.uploadFailed + (err && err.message ? ": " + err.message : "");
    }
  }

  // A command of the toolbar: the formats come from the core's table of
  // commands (Wolly.EditorCommands), so the page and the native Canela apply
  // them the same way; picture, undo, redo and the source view are the page's.
  command(name) {
    if (this.htmlView() && this.htmlCommand(name)) return;
    if (Object.hasOwn(FORMATS, name)) return this.format(FORMATS[name]);
    switch (name) {
      case "link": {
        const url = prompt(this.texts.linkAsk, "https://");
        if (url === null) return;
        this.format("Link");
        // The core leaves the cursor between the parentheses of the address.
        if (url) this.apply(OP.type, 0, url);
        return;
      }
      case "insertTable": return this.apply(OP.table, 303);
      case "image": return this.picker.click();
      case "undo": return this.undo();
      case "redo": return this.redo();
      case "sourceEditing": this.raw = !this.raw; return this.render();
      case "viewMode": return this.switchView();
      default:
        if (name.startsWith("heading")) {
          const level = Number(name.slice(7)) || 0;
          return this.format(level === 0 ? "Paragraph" : "Heading " + level);
        }
        if (name.startsWith("table:")) return this.format(name.slice(6));
    }
  }

  // ---- the DOM ----

  build() {
    let host = this.host;
    if (host.tagName === "TEXTAREA") {
      this.textarea = host;
      this.textareaDisplay = host.style.display;
      host.style.display = "none";
    }
    const root = document.createElement("div");
    root.className = "canela";
    const bar = document.createElement("div");
    bar.className = "canela-toolbar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", this.texts.label);
    for (const item of this.options.toolbar || DEFAULT_TOOLBAR) {
      if (item === "image" && !this.options.upload) continue;
      if (item === "|") {
        const sep = document.createElement("span");
        sep.className = "canela-sep";
        bar.append(sep);
      } else if (item === "heading") {
        const sel = document.createElement("select");
        sel.setAttribute("aria-label", this.texts.heading);
        const named = (english) => this.commands.find((k) => k.english === english)?.name || english;
        sel.append(new Option(named("Paragraph"), "heading0"));
        for (let l = 1; l <= 4; l++) sel.append(new Option(named("Heading " + l), "heading" + l));
        sel.addEventListener("change", () => { this.command(sel.value); this.focus(); });
        this.headingSelect = sel;
        bar.append(sel);
      } else {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "canela-" + item;
        const name = this.label(item);
        b.title = name;
        b.setAttribute("aria-label", name);
        const symbol = icon(item);
        if (symbol) { b.append(symbol); b.classList.add("canela-icon"); } else b.textContent = name;
        b.addEventListener("mousedown", (ev) => ev.preventDefault());
        b.addEventListener("click", () => { this.command(item); this.focus(); });
        if (item === "viewMode") { this.viewButton = b; b.classList.add("canela-viewmode"); }
        bar.append(b);
      }
    }
    // The tools of a table, shown while the cursor stands in one.
    const tableBar = document.createElement("div");
    tableBar.className = "canela-toolbar canela-tablebar";
    tableBar.setAttribute("role", "toolbar");
    tableBar.hidden = true;
    for (const english of TABLE_TOOLS) {
      const c = this.commands.find((k) => k.english === english);
      if (!c) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.title = c.name + (c.shortcut ? " (" + c.shortcut + ")" : "");
      b.setAttribute("aria-label", c.name);
      const symbol = icon(english);
      if (symbol) { b.append(symbol); b.classList.add("canela-icon"); } else b.textContent = c.name;
      b.addEventListener("mousedown", (ev) => ev.preventDefault());
      b.addEventListener("click", () => { if (this.htmlView()) this.htmlTable(english); else this.format(english); this.focus(); });
      tableBar.append(b);
    }
    this.tableBar = tableBar;
    const surface = document.createElement("div");
    surface.className = "canela-surface";
    // One text field for screen readers: the input at the caret.  The drawn
    // surface is a region to read, not a second field that takes no keys.
    surface.setAttribute("role", "region");
    surface.setAttribute("aria-label", (this.options.label || this.texts.label) + " – " + this.texts.preview);
    const input = document.createElement("textarea");
    input.className = "canela-input";
    input.setAttribute("aria-label", this.options.label || this.texts.label);
    input.setAttribute("autocapitalize", "off");
    input.spellcheck = false;
    const status = document.createElement("div");
    status.className = "canela-status";
    status.setAttribute("aria-live", "polite");
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "image/*";
    picker.hidden = true;
    picker.addEventListener("change", () => {
      for (const f of picker.files) this.insertPicture(f);
      picker.value = "";
    });
    root.append(bar, tableBar, surface, input, status, picker);
    if (this.textarea) this.textarea.after(root); else host.append(root);
    Object.assign(this, { root, bar, surface, input, status, picker });
    this.wire();
  }

  focus() {
    this.input.focus({ preventScroll: true });
  }

  wire() {
    const s = this.surface;
    const input = this.input;
    let dragging = false;
    let composing = false;
    s.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      const at = this.offsetAt(ev.clientX, ev.clientY);
      if (at === null) return;
      this.goalX = null;
      if (ev.detail === 2) this.apply(OP.word, at);
      else if (ev.detail >= 3) this.apply(OP.line, at);
      else if (ev.shiftKey) this.select(this.anchor, at);
      else { this.select(at, at); dragging = true; }
      // A click into the text while the input has the focus already moves
      // no focus, and a screen reader says nothing: the focus is given anew,
      // so it announces the field and the text at the caret.
      if (document.activeElement === this.input) this.input.blur();
      this.focus();
    });
    window.addEventListener("mousemove", this.onMove = (ev) => {
      if (!dragging) return;
      const at = this.offsetAt(ev.clientX, ev.clientY);
      if (at !== null && at !== this.head) this.select(this.anchor, at);
    });
    window.addEventListener("mouseup", this.onUp = () => { dragging = false; });
    s.addEventListener("click", (ev) => {
      const box = ev.target.closest("[data-task]");
      if (box) this.apply(OP.task, Number(box.dataset.task));
    });
    // The input holds the text of the block at the caret (mirror), so that a
    // screen reader reads what is there; typing does not change it: an
    // insertion is taken from the event and goes to the core, and the next
    // drawing writes the mirror anew.
    input.addEventListener("compositionstart", () => { composing = true; });
    input.addEventListener("compositionend", (ev) => {
      composing = false;
      if (ev.data) this.typeText(ev.data);
      else this.mirror();
    });
    input.addEventListener("beforeinput", (ev) => {
      if (composing || ev.isComposing) return;
      if (ev.inputType === "insertText" || ev.inputType === "insertReplacementText") {
        ev.preventDefault();
        const text = ev.data ?? (ev.dataTransfer ? ev.dataTransfer.getData("text/plain") : "");
        if (text) this.typeText(text);
      } else if (ev.inputType === "deleteContentBackward" || ev.inputType === "deleteContentForward") {
        ev.preventDefault();
        this.key(new KeyboardEvent("keydown", { key: ev.inputType === "deleteContentBackward" ? "Backspace" : "Delete" }));
      } else if (ev.inputType === "insertLineBreak" || ev.inputType === "insertParagraph") {
        ev.preventDefault();
        this.key(new KeyboardEvent("keydown", { key: "Enter", shiftKey: ev.inputType === "insertLineBreak" }));
      }
    });
    input.addEventListener("input", () => {
      if (!composing) this.mirror();
    });
    input.addEventListener("keydown", (ev) => this.key(ev));
    input.addEventListener("paste", (ev) => {
      ev.preventDefault();
      const data = ev.clipboardData;
      const files = [...data.files].filter((f) => f.type.startsWith("image/"));
      if (files.length > 0 && this.options.upload) {
        for (const f of files) this.insertPicture(f);
        return;
      }
      const html = cleanPastedHtml(data.getData("text/html"));
      const text = data.getData("text/plain");
      if (this.mode === MODES.plain) this.apply(OP.type, 0, text);
      else if (this.mode === MODES.html) this.apply(OP.paste, 0, plainEntities(html), text);
      else if (html) this.apply(OP.type, 0, decoder.decode(this.markdownOf(html)).replace(/\n$/, ""));
      else this.apply(OP.type, 0, text);
    });
    const copy = (ev, cut) => {
      ev.preventDefault();
      const bytes = this.selectedBytes();
      ev.clipboardData.setData("text/plain", decoder.decode(bytes));
      if (this.mode === MODES.markdown) {
        ev.clipboardData.setData("text/html", decoder.decode(call(this.hilde, (p, n, out, room) =>
          this.hilde.exports.canela_to_html(0, p[0].address, p[0].length, out, room),
        [bytes], [], bytes.length * 2 + 64)));
      }
      if (cut && bytes.length > 0) this.apply(OP.back);
    };
    input.addEventListener("copy", (ev) => copy(ev, false));
    input.addEventListener("cut", (ev) => copy(ev, true));
    s.addEventListener("dragover", (ev) => ev.preventDefault());
    s.addEventListener("drop", (ev) => {
      ev.preventDefault();
      const at = this.offsetAt(ev.clientX, ev.clientY);
      if (at !== null) this.select(at, at);
      for (const f of ev.dataTransfer.files) if (f.type.startsWith("image/")) this.insertPicture(f);
    });
    input.addEventListener("focus", () => this.root.classList.add("canela-focus"));
    input.addEventListener("blur", () => this.root.classList.remove("canela-focus"));
  }

  markdownOf(html) {
    const bytes = encoder.encode(plainEntities(html));
    return call(this.hilde, (p, n, out, room) => this.hilde.exports.canela_from_html(
      0, p[0].address, p[0].length, out, room), [bytes], [], bytes.length + 64);
  }

  key(ev) {
    if (this.htmlView() && this.htmlKey(ev)) { ev.preventDefault(); return; }
    const mod = ev.metaKey || ev.ctrlKey;
    const extend = ev.shiftKey ? 1 : 0;
    const k = ev.key;
    let handled = true;
    if (mod && k.toLowerCase() === "z") ev.shiftKey ? this.redo() : this.undo();
    else if (mod && k.toLowerCase() === "y") this.redo();
    else if (mod && k.toLowerCase() === "a") this.apply(OP.all);
    else if (mod && k.toLowerCase() === "b") this.command("bold");
    else if (mod && k.toLowerCase() === "i") this.command("italic");
    else if (mod && k.toLowerCase() === "k") this.command("link");
    else if (mod && k >= "0" && k <= "6" && !ev.shiftKey) this.apply(OP.heading, Number(k));
    else if (mod && k.toLowerCase() === "e") this.command("code");
    else if (mod && ev.shiftKey && k.toLowerCase() === "x") this.command("strikethrough");
    else if (mod && ev.shiftKey && k.toLowerCase() === "h") this.command("highlight");
    else if (mod && k === "Enter" && this.inTable()) this.format("Add Row Below");
    else if (mod && (k === "c" || k === "x" || k === "v")) handled = false;
    else if (k === "Enter") this.apply(ev.shiftKey ? OP.shiftRet : OP.ret);
    else if (k === "Backspace") this.apply(OP.back);
    else if (k === "Delete") this.apply(OP.del);
    else if (k === "Tab" && this.inTable()) this.apply(OP.cell, ev.shiftKey ? 1 : 0);
    else if (k === "Tab") handled = false;
    else if (k === "ArrowLeft") { this.goalX = null; this.apply(mod ? OP.lineStart : OP.left, extend); }
    else if (k === "ArrowRight") { this.goalX = null; this.apply(mod ? OP.lineEnd : OP.right, extend); }
    else if (k === "Home") this.apply(OP.lineStart, extend);
    else if (k === "End") this.apply(OP.lineEnd, extend);
    else if (k === "ArrowUp" || k === "ArrowDown") this.vertical(k === "ArrowUp" ? -1 : 1, extend);
    else handled = false;
    if (handled) ev.preventDefault();
  }

  // Up and down: the place one line above or below the caret, at the
  // column the caret had when the moves began.
  vertical(direction, extend) {
    const caret = this.surface.querySelector(".canela-caret");
    if (!caret) return;
    const cr = caret.getBoundingClientRect();
    if (this.goalX === null) this.goalX = cr.left;
    const goal = this.goalX;
    const at = this.lineTarget(direction, cr, goal);
    this.select(extend ? this.anchor : at, at);
    this.goalX = goal;
  }

  // The place on the next line of text above (direction -1) or below (1)
  // the caret, nearest to the column x.  It is found from the drawn lines
  // themselves (the rectangles of the text and of each character), so it
  // works off the screen and across the margins of a drawn page; the
  // blanks that only lay out HTML source are no line.  Above the first line
  // the start of the document, below the last its end.
  lineTarget(direction, cr, x) {
    const cy = (cr.top + cr.bottom) / 2;
    const half = Math.max(cr.height / 2, 4);
    const allSegs = [...this.surface.querySelectorAll("[data-s]")].filter((seg) => {
      if (seg.classList.contains("canela-hidden")) return false;
      const text = seg.textContent;
      return text.length > 0 && !(/\n/.test(text) && /^\s*$/.test(text));
    });
    // The search over the lines of a set of text: the place nearest to x
    // on the nearest line that moves the caret, or null.
    const pick = (segs) => {
      // The lines in the direction, nearest first, each by the top of its text.
      const tops = [];
      for (const seg of segs) {
        for (const r of seg.getClientRects()) {
          if (r.height === 0) continue;
          const dy = ((r.top + r.bottom) / 2 - cy) * direction;
          if (dy < half) continue;
          if (!tops.some((t) => Math.abs(t.top - r.top) < 2)) tops.push({ top: r.top, dy });
        }
      }
      tops.sort((a, b) => a.dy - b.dy);
      const range = document.createRange();
      // A line whose nearest place is the caret's own (a wrapped line starts
      // where the one above ends) moves nothing: then the line after it.
      for (const { top: lineTop } of tops) {
        let best = null;
        let bestDx = Infinity;
        for (const seg of segs) {
          const node = [...seg.childNodes].find((c) => c.nodeType === Node.TEXT_NODE);
          if (!node || node.nodeType !== Node.TEXT_NODE) continue;
          const onLine = [...seg.getClientRects()].some((r) => Math.abs(r.top - lineTop) < 2);
          if (!onLine) continue;
          const text = node.data;
          for (let i = 0; i <= text.length; i++) {
            // A boundary: the left edge of character i, or the right edge of the last.
            const k = i < text.length ? i : i - 1;
            if (k < 0) continue;
            range.setStart(node, k);
            range.setEnd(node, k + 1);
            const rects = range.getClientRects();
            const r = rects.length > 0 ? rects[rects.length - 1] : null;
            if (!r || Math.abs(r.top - lineTop) >= 2) continue;
            // The blank where a line wraps hangs at the end of the line above
            // and reports the place of the next line's start; a caret before
            // it is drawn on the line above.  It is no boundary of this line.
            if (i < text.length && /\s/.test(text[i]) && i + 1 < text.length) {
              range.setStart(node, i + 1);
              range.setEnd(node, i + 2);
              const next = range.getClientRects();
              const n = next.length > 0 ? next[0] : null;
              if (n && n.left <= r.left + 0.5) continue;
            }
            const edge = i < text.length ? r.left : r.right;
            const dx = Math.abs(edge - x);
            if (dx < bestDx) { bestDx = dx; best = { seg, i }; }
          }
        }
        if (best === null) continue;
        const places = this.segPlaces && this.segPlaces.get(best.seg);
        const at = places ? places[Math.min(best.i, places.length - 1)]
          : Number(best.seg.dataset.s) + encoder.encode([...best.seg.childNodes].find((c) => c.nodeType === Node.TEXT_NODE).data.slice(0, best.i)).length;
        if (at !== this.head) return at;
      }
      return null;
    };
    // On a page of columns (cards side by side) up and down stay in the
    // caret's column; at its end they go on above or below the row of the
    // columns, and only then anywhere.  The column is the outermost element
    // around the caret that is narrower than the page, the row the element
    // as wide as the page around it.
    // A column has a sibling beside it, at the same height; a narrow
    // element alone (a short heading, a box of its own) is none.
    const besideAnother = (el) => {
      const r = el.getBoundingClientRect();
      return [...el.parentElement.children].some((s) => {
        if (s === el) return false;
        const q = s.getBoundingClientRect();
        return q.width > 0 && q.top < r.bottom && q.bottom > r.top && (q.right <= r.left + 1 || q.left >= r.right - 1);
      });
    };
    const caretEl = this.surface.querySelector(".canela-caret");
    const pageWidth = this.surface.getBoundingClientRect().width;
    let column = null;
    let row = null;
    for (let el = caretEl ? caretEl.parentElement : null; el && el !== this.surface; el = el.parentElement) {
      const width = el.getBoundingClientRect().width;
      if (width < pageWidth * 0.8 && besideAnother(el)) column = el;
      else if (column && width >= pageWidth * 0.8) { row = el; break; }
    }
    const groups = [];
    if (column) {
      groups.push(allSegs.filter((s) => column.contains(s)));
      if (row) groups.push(allSegs.filter((s) => !row.contains(s)));
    }
    groups.push(allSegs);
    for (const segs of groups) {
      const at = pick(segs);
      if (at !== null) return at;
    }
    {
      const first = this.htmlView() && this.places.length > 0 ? this.places[0].at : 0;
      // The end of the last block's text, not past the line feed that ends
      // the source: there no block holds the caret and it is not drawn.
      const blocks = this.layoutCache || [];
      const tail = blocks.length > 0 ? blocks[blocks.length - 1] : null;
      let end = tail ? Math.max(tail.content, tail.contentStop) : this.source.length;
      while (end > 0 && this.source[end - 1] === 10) end--;
      const last = this.htmlView() && this.places.length > 0 ? this.places[this.places.length - 1].at : end;
      return direction < 0 ? first : last;
    }
  }

  // The byte of the source under a point of the screen.
  offsetAt(x, y) {
    let node = null;
    let offset = 0;
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (p) { node = p.offsetNode; offset = p.offset; }
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (r) { node = r.startContainer; offset = r.startOffset; }
    }
    if (!node || !this.surface.contains(node)) {
      const rect = this.surface.getBoundingClientRect();
      if (y < rect.top) return 0;
      if (y > rect.bottom) return this.source.length;
      return null;
    }
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const seg = el.closest("[data-s]");
    if (!seg) {
      const block = el.closest("[data-b]");
      if (block && this.htmlView()) return this.nearestPlace(block, x, y);
      return block ? Number(block.dataset.e) : null;
    }
    if (node.nodeType !== Node.TEXT_NODE) return Number(seg.dataset.s);
    if (this.htmlView() && /\n/.test(seg.textContent) && /^\s*$/.test(seg.textContent)) {
      return this.nearestPlace(seg.closest("[data-b]") || this.surface, x, y);
    }
    const places = this.segPlaces && this.segPlaces.get(seg);
    if (places) return places[Math.min(offset, places.length - 1)];
    const text = node.textContent.slice(0, offset);
    return Number(seg.dataset.s) + encoder.encode(text).length;
  }

  // ---- drawing ----

  render() {
    const blocks = this.layoutCache = this.layout();
    const s = this.surface;
    s.textContent = "";
    s.classList.toggle("canela-raw", !this.htmlView() && (!!this.raw || this.mode !== MODES.markdown));
    s.classList.toggle("canela-page", this.htmlView());
    const from = Math.min(this.anchor, this.head);
    const to = Math.max(this.anchor, this.head);
    if (this.htmlView()) this.drawHtml(blocks, from, to);
    else blocks.forEach((block, index) => s.append(this.drawBlock(block, index, from, to)));
    if (blocks.length === 0) s.append(document.createElement("p"));
    this.place();
    this.mirror();
    this.count();
    this.tableBar.hidden = this.htmlView() ? !this.caretCell() : !this.inTable();
    if (this.viewButton) {
      // The button names the view it is in; plain text has no other view.
      this.viewButton.hidden = this.mode === MODES.plain;
      this.viewButton.textContent = this.mode === MODES.markdown ? this.texts.viewMarkdown : this.texts.viewHtml;
    }
    if (this.headingSelect) {
      const b = this.blockAtCursor();
      this.headingSelect.value = "heading" + (b && b.kind === "heading" ? Math.min(b.level, 4) : 0);
    }
  }

  // A block: its prefix, its text cut at the spans, the caret and the
  // selection; markers hidden unless the core says they are shown.
  drawBlock(block, index, from, to) {
    const raw = this.raw || this.mode !== MODES.markdown;
    const tag = raw ? "div" : block.kind === "heading" ? "h" + Math.min(Math.max(block.level, 1), 6)
      : block.kind === "fence" || block.kind === "mermaid" || block.kind === "frontmatter" ? "pre"
      : block.kind === "quote" ? "blockquote" : block.kind === "rule" ? "div" : "p";
    const el = document.createElement(tag);
    el.className = "canela-block canela-" + block.kind;
    el.dataset.b = index;
    el.dataset.e = block.stop;
    if (block.level && !raw) el.style.setProperty("--level", block.level);
    const inBlock = this.head >= block.start && this.head <= block.stop;
    if (!raw && block.kind === "task") {
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = block.checked;
      box.dataset.task = index;
      box.tabIndex = -1;
      box.contentEditable = "false";
      el.append(box);
    }
    if (!raw && (block.kind === "bullet" || block.kind === "ordered")) {
      el.dataset.marker = block.kind === "ordered" ? block.number + "." : "•";
    }
    // Cuts: where a span's markers begin and end, the content's bounds.
    const marks = [];
    if (!raw) {
      if (block.content > block.start) marks.push({ start: block.start, stop: block.content, shown: inBlock || block.kind === "rule" });
      // A code fence: its opening line (``` and the language) and its closing
      // line are markers too, shown only while the caret is in the block; the
      // core counts the whole fence as content.
      if ((block.kind === "fence" || block.kind === "mermaid") && block.content === block.start) {
        const src = this.source;
        let open = block.start;
        while (open < block.stop && src[open] !== 10) open++;
        if (open < block.stop) open++;
        marks.push({ start: block.start, stop: open, shown: inBlock });
        let end = block.stop;
        while (end > open && src[end - 1] === 10) end--;
        let close = end;
        while (close > open && src[close - 1] !== 10) close--;
        const last = new TextDecoder().decode(src.slice(close, end)).trim();
        if (/^(`{3,}|~{3,})$/.test(last)) marks.push({ start: close > open ? close - 1 : close, stop: block.stop, shown: inBlock });
      }
      if (block.contentStop < block.stop) marks.push({ start: block.contentStop, stop: block.stop, shown: inBlock });
      for (const sp of block.spans) {
        if (sp.innerStart > sp.start) marks.push({ start: sp.start, stop: sp.innerStart, shown: sp.shown, kind: sp.kind });
        if (sp.stop > sp.innerStop) marks.push({ start: sp.innerStop, stop: sp.stop, shown: sp.shown, kind: sp.kind });
      }
    }
    const cuts = new Set([block.start, block.stop, from, to, this.head]);
    for (const m of marks) { cuts.add(m.start); cuts.add(m.stop); }
    for (const sp of block.spans) { cuts.add(sp.start); cuts.add(sp.stop); }
    const points = [...cuts].filter((c) => c >= block.start && c <= block.stop).sort((a, b) => a - b);
    // A picture whose markers are hidden is drawn as the picture; with the
    // caret on it, its source shows as for any other span.
    const pictures = raw ? [] : block.spans.filter((sp) => sp.kind === "image" && !sp.shown).map((sp) => {
      const text = decoder.decode(this.source.slice(sp.start, sp.stop));
      const m = /^!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)$/.exec(text);
      return m ? { start: sp.start, stop: sp.stop, alt: m[1], src: m[2] } : null;
    }).filter(Boolean);
    for (let i = 0; i <= points.length - 1; i++) {
      const a = points[i];
      const b = i + 1 < points.length ? points[i + 1] : a;
      const caretHere = a === this.head;
      const picture = pictures.find((p) => a >= p.start && a < p.stop);
      if (picture) {
        if (a === picture.start) {
          if (caretHere) el.append(this.caret());
          const img = document.createElement("img");
          img.className = "canela-picture";
          img.alt = picture.alt;
          // Only a path of this site or http(s): no other scheme reaches src.
          if (/^(\/(?!\/)|https?:\/\/)/i.test(picture.src)) img.src = picture.src;
          img.dataset.s = picture.start;
          el.append(img);
        }
        continue;
      }
      if (b <= a) { if (caretHere) el.append(this.caret()); continue; }
      let bytes = this.source.slice(a, b);
      if (bytes.length > 0 && bytes[bytes.length - 1] === 10 && b === block.stop) bytes = bytes.slice(0, -1);
      const seg = document.createElement("span");
      seg.dataset.s = a;
      seg.textContent = decoder.decode(bytes);
      const mark = marks.find((m) => a >= m.start && b <= m.stop);
      if (mark) seg.className = mark.shown ? "canela-mark" : "canela-mark canela-hidden";
      const classes = block.spans.filter((sp) => a >= sp.innerStart && b <= sp.innerStop).map((sp) => "canela-" + sp.kind);
      if (classes.length > 0) seg.classList.add(...classes);
      if (a >= from && b <= to && from < to) seg.classList.add("canela-selected");
      if (caretHere) { if (seg.classList.contains("canela-hidden")) el.append(this.caret()); else seg.prepend(this.caret()); }
      el.append(seg);
    }
    if (el.childNodes.length === 0 || (el.childNodes.length === 1 && el.firstChild.classList?.contains("canela-caret"))) {
      el.append(document.createTextNode("\u200b"));
    }
    return el;
  }

  // The HTML mode reads its source cleaned, each block on a line: an edit
  // can leave it otherwise (</p><p> on one line), and the places the core
  // reports would then not be the places of this source.  So the source is
  // cleaned after every edit, and the selection kept by its place among the
  // characters of the text, which cleaning does not move.
  normalHtml(r) {
    const before = textPlaces(r.source);
    const rank = (at) => { let i = 0; while (i + 1 < before.length && before[i + 1] <= at) i++; return i; };
    const anchorRank = rank(r.anchor);
    const headRank = rank(r.head);
    const keep = { source: this.source, anchor: this.anchor, head: this.head };
    this.source = r.source;
    this.anchor = this.head = 0;
    const clean = this.edit(OP.none);
    Object.assign(this, keep);
    const after = textPlaces(clean.source);
    const at = (k) => (after.length === 0 ? 0 : after[Math.min(k, after.length - 1)]);
    return { source: clean.source, anchor: at(anchorRank), head: at(headRank) };
  }

  // Writes the text of the block at the caret into the input, with the
  // selection where the caret is, for screen readers and the input methods
  // of the system.  In the drawn HTML mode the visible text, otherwise the
  // source of the block from its content on.
  mirror() {
    const input = this.input;
    if (!input || this.composingNow) return;
    const block = this.blockAtCursor();
    if (!block) { input.value = ""; return; }
    let text = "";
    let a = 0;
    let b = 0;
    const from = Math.min(this.anchor, this.head);
    const to = Math.max(this.anchor, this.head);
    if (this.htmlView()) {
      const mine = this.places.filter((p) => p.block === block && p.run);
      const runs = [...new Set(mine.map((p) => p.run))];
      for (const run of runs) {
        for (let k = 0; k <= run.text.length; k++) {
          if (run.offs[k] <= from) a = text.length + k;
          if (run.offs[k] <= to) b = text.length + k;
        }
        text += run.text;
      }
    } else {
      const start = block.content;
      const stop = Math.max(start, block.contentStop);
      text = decoder.decode(this.source.slice(start, stop)).replace(/\n$/, "");
      const clamp = (x) => Math.min(Math.max(x, start), stop);
      a = decoder.decode(this.source.slice(start, clamp(from))).length;
      b = decoder.decode(this.source.slice(start, clamp(to))).length;
    }
    input.value = text;
    a = Math.min(a, text.length);
    b = Math.min(Math.max(b, a), text.length);
    try { input.setSelectionRange(a, b, this.head < this.anchor ? "backward" : "forward"); } catch (e) { /* not focusable yet */ }
  }

  // A point on no text of a drawn HTML block (a margin, the padding of a
  // card): the place on the nearest line of text, at its start or end by x.
  nearestPlace(block, x, y) {
    let best = null;
    let bestDistance = Infinity;
    for (const seg of block.querySelectorAll("[data-s]")) {
      if (/\n/.test(seg.textContent) && /^\s*$/.test(seg.textContent)) continue;
      const places = this.segPlaces.get(seg);
      if (!places) continue;
      for (const r of seg.getClientRects()) {
        const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
        const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
        const distance = dy * 1000 + dx;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = x <= r.left ? places[0] : x >= r.right ? places[places.length - 1] : places[0];
        }
      }
    }
    return best === null ? Number(block.dataset.e) : best;
  }

  // The cell of a table the caret stands in, in the drawn HTML mode.
  caretCell() {
    const caret = this.surface.querySelector(".canela-caret");
    return caret ? caret.closest("td, th") : null;
  }

  // A tool of a table in the drawn HTML mode: the block that holds the
  // table is parsed anew from the source, the same table, row and cell are
  // found by their places among their kind, changed, and the block is
  // written back as one edit.
  htmlTable(english) {
    const cell = this.caretCell();
    if (!cell) return;
    const blockEl = cell.closest("[data-b]");
    const block = this.layoutCache[Number(blockEl.dataset.b)];
    const table = cell.closest("table");
    const tableIndex = [...blockEl.querySelectorAll("table")].indexOf(table);
    const row = cell.parentElement;
    const rowIndex = [...table.rows].indexOf(row);
    const cellIndex = [...row.cells].indexOf(cell);
    const template = document.createElement("template");
    template.innerHTML = decoder.decode(this.source.slice(block.start, block.stop));
    const t = template.content.querySelectorAll("table")[tableIndex];
    if (!t || !t.rows[rowIndex]) return;
    const r = t.rows[rowIndex];
    const emptyCell = (tag) => { const c = document.createElement(tag); c.textContent = "\u00a0"; return c; };
    switch (english) {
      case "Add Row Below": {
        const fresh = document.createElement("tr");
        for (const c of r.cells) fresh.append(emptyCell("td"));
        r.after(fresh);
        break;
      }
      case "Add Column Right":
        for (const tr of t.rows) {
          const at = tr.cells[Math.min(cellIndex, tr.cells.length - 1)];
          const tag = at && at.tagName === "TH" ? "th" : "td";
          if (at) at.after(emptyCell(tag)); else tr.append(emptyCell(tag));
        }
        break;
      case "Delete Row":
        if (t.rows.length > 1) r.remove();
        break;
      case "Delete Column":
        if (r.cells.length > 1) for (const tr of t.rows) if (tr.cells[cellIndex]) tr.cells[cellIndex].remove();
        break;
      case "Align Column Left":
      case "Align Column Center":
      case "Align Column Right": {
        const side = english.endsWith("Left") ? "left" : english.endsWith("Center") ? "center" : "right";
        for (const tr of t.rows) if (tr.cells[cellIndex]) tr.cells[cellIndex].style.textAlign = side;
        break;
      }
      default:
        return;
    }
    const keep = { block: Number(blockEl.dataset.b), table: tableIndex, row: rowIndex, cell: cellIndex };
    let html = template.innerHTML;
    if (!html.endsWith("\n")) html += "\n";
    this.replaceRange(block.start, block.stop, html);
    // The caret back into the cell it stood in, or the nearest that is left.
    const blockNow = this.surface.querySelector('[data-b="' + keep.block + '"]');
    const tableNow = blockNow && blockNow.querySelectorAll("table")[keep.table];
    const rowNow = tableNow && tableNow.rows[Math.min(keep.row, tableNow.rows.length - 1)];
    const cellNow = rowNow && rowNow.cells[Math.min(keep.cell, rowNow.cells.length - 1)];
    const seg = cellNow && cellNow.querySelector("[data-s]");
    if (seg) {
      const at = Number(seg.dataset.s);
      this.select(at, at);
    }
  }

  // ---- the HTML mode drawn as a page (html-view.js) ----

  htmlView() {
    return this.mode === MODES.html && !this.raw;
  }

  // Typed text: in the drawn HTML mode escaped, so that it stays text.
  typeText(text) {
    this.apply(OP.type, 0, this.htmlView() ? escapeText(text) : text);
  }

  drawHtml(blocks, from, to) {
    this.segPlaces = new WeakMap();
    this.places = caretPlaces(this.source, blocks);
    if (this.places.length > 0 && !this.places.some((p) => p.at === this.head)) {
      const next = this.places.find((p) => p.at >= this.head) || this.places[this.places.length - 1];
      if (this.anchor === this.head) this.anchor = next.at;
      this.head = next.at;
    }
    blocks.forEach((block, index) => this.surface.append(drawHtmlBlock(this.source, block, index, from, to,
      this.head, this.segPlaces, () => this.caret())));
  }

  placeIndex(at) {
    let best = 0;
    for (let i = 0; i < this.places.length; i++) if (this.places[i].at <= at) best = i;
    return best;
  }

  // Replaces source[a, b) by text, the caret after it.
  replaceRange(a, b, text) {
    this.anchor = a;
    this.head = b;
    this.apply(OP.type, 0, text);
  }

  // The character before (or after) the caret as a range of the source,
  // when it stands in the same block; null at the edge of the block.
  charRange(forward) {
    const i = this.places.findIndex((p) => p.at === this.head);
    if (i < 0) return null;
    const here = this.places[i];
    const j = forward ? i + 1 : i - 1;
    const there = this.places[j];
    if (!there || there.block !== here.block) return null;
    if (forward) {
      const run = here.run && here.k < here.run.text.length ? here.run : there.run;
      const k = run === here.run ? here.k : 0;
      return run ? [run.offs[k], run.offs[k + 1]] : null;
    }
    const run = here.run && here.k > 0 ? here.run : there.run;
    const k = run === here.run ? here.k : run.text.length;
    return run ? [run.offs[k - 1], run.offs[k]] : null;
  }

  // Joins block i with the block before it, when both are simple elements:
  // the end tag of the first and the start tag of the second go.
  joinBlocks(i) {
    const blocks = this.layoutCache;
    if (i <= 0 || i >= blocks.length) return;
    const a = blocks[i - 1];
    const b = blocks[i];
    if (!simpleTag(this.source, a) || !simpleTag(this.source, b)) return;
    this.replaceRange(a.contentStop, b.content, "");
  }

  htmlKey(ev) {
    const mod = ev.metaKey || ev.ctrlKey;
    const k = ev.key;
    const from = Math.min(this.anchor, this.head);
    const to = Math.max(this.anchor, this.head);
    const blockIndex = this.layoutCache.findIndex((b) => this.head >= b.start && this.head <= b.stop);
    const block = this.layoutCache[blockIndex];
    if (k === "Backspace" || k === "Delete") {
      if (from < to) { this.replaceRange(from, to, ""); return true; }
      const forward = k === "Delete";
      const i = this.places.findIndex((p) => p.at === this.head);
      const here = this.places[i];
      // An empty element goes as a whole with Backspace.
      if (here && here.run && here.run.empty && !forward) {
        const text = this.source;
        let open = here.at - 1;
        while (open > 0 && text[open] !== 60) open--;
        let close = here.at;
        while (close < text.length && text[close] !== 62) close++;
        const before = this.places[i - 1];
        this.replaceRange(open, close + 1, "");
        if (before && before.at < open) this.select(before.at, before.at);
        return true;
      }
      // Two items or paragraphs next to each other join when the caret
      // stands at the edge between them.
      const there = this.places[forward ? i + 1 : i - 1];
      if (here && there && there.block === here.block) {
        const a = Math.min(here.at, there.at);
        const b = Math.max(here.at, there.at);
        const gap = decoder.decode(this.source.slice(a, b));
        if (/^<\/(li|p|h[1-6])>\s*<(li|p|h[1-6])(\s[^>]*)?>$/.test(gap)) {
          this.replaceRange(a, b, "");
          return true;
        }
      }
      const range = this.charRange(forward);
      if (range) { this.replaceRange(range[0], range[1], ""); this.lastGroup = "back"; return true; }
      this.joinBlocks(k === "Delete" ? blockIndex + 1 : blockIndex);
      return true;
    }
    if (k === "Enter") {
      const caretEl = this.surface.querySelector(".canela-caret");
      const holder = caretEl && caretEl.parentElement.closest("p, li, h1, h2, h3, h4, h5, h6, td, th, pre, div");
      const tag = holder && !holder.classList.contains("canela-block") ? holder.tagName.toLowerCase() : null;
      if (ev.shiftKey || !tag || tag === "pre" || tag === "td" || tag === "th" || tag === "div") {
        this.replaceRange(from, to, "<br>");
      } else {
        const next = /^h[1-6]$/.test(tag) ? "p" : tag;
        this.replaceRange(from, to, "</" + tag + "><" + next + ">");
      }
      return true;
    }
    if (k === "Tab") {
      // In a table: the next cell (Shift: the one before), its first place.
      const cell = this.caretCell();
      if (!cell) return false;
      const table = cell.closest("table");
      const cells = [...table.querySelectorAll("td, th")].filter((c) => c.closest("table") === table);
      const next = cells[cells.indexOf(cell) + (ev.shiftKey ? -1 : 1)];
      const seg = next && next.querySelector("[data-s]");
      if (seg) {
        const at = Number(seg.dataset.s);
        this.select(at, at);
      }
      return true;
    }
    if (mod) return false;
    if (k === "ArrowLeft" || k === "ArrowRight" || k === "Home" || k === "End") {
      if (this.places.length === 0) return true;
      let i = this.placeIndex(this.head);
      if (k === "ArrowLeft") i = Math.max(0, i - 1);
      else if (k === "ArrowRight") i = Math.min(this.places.length - 1, i + 1);
      else {
        const inBlock = this.places.filter((p) => p.block === this.places[i].block);
        i = this.places.indexOf(k === "Home" ? inBlock[0] : inBlock[inBlock.length - 1]);
      }
      const at = this.places[i].at;
      this.goalX = null;
      this.select(ev.shiftKey ? this.anchor : at, at);
      return true;
    }
    return false;
  }

  // Formats in the drawn HTML mode, as tags around the selection or in
  // place of the tags of the block.
  htmlCommand(name) {
    const inline = { bold: "strong", italic: "em", code: "code", strikethrough: "s", highlight: "mark" };
    const from = Math.min(this.anchor, this.head);
    const to = Math.max(this.anchor, this.head);
    const block = this.blockAtCursor();
    const inner = block ? decoder.decode(this.source.slice(block.content, block.contentStop)) : "";
    const whole = (open, close) => this.replaceRange(block.start, block.stop, open + inner + close + "\n");
    if (name in inline || name === "link") {
      let open = "<" + inline[name] + ">";
      let close = "</" + inline[name] + ">";
      if (name === "link") {
        const url = prompt(this.texts.linkAsk, "https://");
        if (!url) return true;
        open = "<a href=\"" + escapeAttribute(url) + "\">";
        close = "</a>";
      }
      const selected = decoder.decode(this.source.slice(from, to));
      this.replaceRange(from, to, open + selected + close);
      return true;
    }
    if (!block) return true;
    const simple = simpleTag(this.source, block);
    if (name.startsWith("heading")) {
      if (!simple) return true;
      const level = Number(name.slice(7)) || 0;
      const tag = level === 0 ? "p" : "h" + level;
      whole("<" + tag + ">", "</" + tag + ">");
      return true;
    }
    const wrap = { bulletedList: ["<ul>\n<li>", "</li>\n</ul>"], numberedList: ["<ol>\n<li>", "</li>\n</ol>"],
      blockQuote: ["<blockquote><p>", "</p></blockquote>"], codeBlock: ["<pre><code>", "</code></pre>"] };
    if (name in wrap) {
      if (simple) whole(wrap[name][0], wrap[name][1]);
      return true;
    }
    const after = { horizontalLine: "<hr>", insertTable: "<table>\n<tr><th>&nbsp;</th><th>&nbsp;</th></tr>\n<tr><td>&nbsp;</td><td>&nbsp;</td></tr>\n</table>",
      todoList: null };
    if (name in after) {
      if (after[name]) this.replaceRange(block.stop, block.stop, after[name] + "\n<p></p>\n");
      return true;
    }
    return false;
  }

  caret() {
    const c = document.createElement("span");
    c.className = "canela-caret";
    c.setAttribute("aria-hidden", "true");
    return c;
  }

  // Puts the hidden input at the caret, so that the input methods of the
  // system open their windows there, and scrolls the caret into view.
  place() {
    const caret = this.surface.querySelector(".canela-caret");
    if (!caret) return;
    const r = caret.getBoundingClientRect();
    const base = this.root.getBoundingClientRect();
    this.input.style.left = (r.left - base.left) + "px";
    this.input.style.top = (r.top - base.top) + "px";
    if (document.activeElement === this.input) caret.scrollIntoView({ block: "nearest" });
  }

  count() {
    const text = this.htmlView() ? this.surface.textContent.replace(/\u200b/g, "") : decoder.decode(this.source);
    const n = (text.match(/[\p{L}\p{N}]+/gu) || []).length;
    this.status.textContent = n + " " + this.texts.words + ", " + [...text].length + " " + this.texts.characters;
  }
}

function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export const Canela = {
  // An editor in place of host (a textarea or any element); a textarea
  // gives its value as the content and gets the content back on every edit.
  async create(host, options = {}) {
    const url = options.wasm || new URL("canela.wasm", import.meta.url).href;
    const hilde = await core(url);
    const editor = new Editor(hilde, host, options);
    const initial = options.data ?? (host.tagName === "TEXTAREA" ? host.value : "");
    editor.setData(initial);
    return editor;
  },
};
