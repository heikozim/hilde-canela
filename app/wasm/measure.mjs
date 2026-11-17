// Part of Canela, a live Markdown editor in Hilde.
//
// SPDX-FileCopyrightText: 2026 Heiko Zimmermann
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
// What stored HTML keeps through Canela: every file of a directory goes in
// with canela_from_html and out with canela_to_html, once in the Markdown
// mode and once in the HTML mode; the tags and attributes are counted
// before and after, summed over all files.
//
//     node measure.mjs canela.wasm <directory of .html files>

import { readFile, readdir } from "node:fs/promises";
import { loadHilde } from "./hilde-wasm.js";

const hilde = await loadHilde(await readFile(process.argv[2]));
const e = hilde.exports;
const enc = new TextEncoder();
const dec = new TextDecoder();

function call(fn, input) {
  const mem = () => new Uint8Array(e.memory.buffer);
  const a = e.hilde_wasm_alloc(Math.max(input.length, 1));
  mem().set(input, a);
  let room = input.length * 2 + 256;
  for (;;) {
    const out = e.hilde_wasm_alloc(room);
    const size = fn(a, input.length, out, room) >>> 0;
    const bytes = mem().slice(out, out + size);
    e.hilde_wasm_free(out);
    if (size <= room) { e.hilde_wasm_free(a); return bytes; }
    room = size;
  }
}

function count(html, into) {
  for (const m of html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
    const tag = m[1].toLowerCase();
    into["<" + tag] = (into["<" + tag] || 0) + 1;
    for (const a of m[2].matchAll(/([a-zA-Z-]+)\s*=/g)) {
      const key = "@" + a[1].toLowerCase();
      into[key] = (into[key] || 0) + 1;
    }
  }
}

const dir = process.argv[3];
const files = (await readdir(dir)).filter((f) => f.endsWith(".html")).sort();
const before = {};
const afterMd = {};
const afterHtml = {};
let textBefore = 0;
let textMd = 0;
let textHtml = 0;
let failed = 0;
let markdownKeeps = 0;
const plain = (h) => h.replace(/<[^>]*>/g, "").replace(/&[a-z#0-9]+;/gi, "x").replace(/\s+/g, "").length;
for (const f of files) {
  const html = await readFile(dir + "/" + f, "utf8");
  try {
    const md = call((a, n, o, r) => e.canela_from_html(0, a, n, o, r), enc.encode(html));
    const outMd = dec.decode(call((a, n, o, r) => e.canela_to_html(0, a, n, o, r), md));
    const src = call((a, n, o, r) => e.canela_from_html(1, a, n, o, r), enc.encode(html));
    const outHtml = dec.decode(call((a, n, o, r) => e.canela_to_html(1, a, n, o, r), src));
    count(html, before);
    count(outMd, afterMd);
    count(outHtml, afterHtml);
    textBefore += plain(html);
    textMd += plain(outMd);
    textHtml += plain(outHtml);
    const shape = (h) => h.replace(/\s+/g, "").replace(/rel="[^"]*"/g, "").replace(/<\/?(thead|tbody)>/g, "");
    if (shape(outMd) === shape(outHtml)) markdownKeeps++;
  } catch (err) {
    failed++;
    console.log("FAILED " + f + ": " + err.message);
  }
}
console.log("files " + files.length + ", failed " + failed + ", markdown keeps " + markdownKeeps);
console.log("visible characters: before " + textBefore + ", markdown mode " + textMd + ", html mode " + textHtml);
const keys = [...new Set([...Object.keys(before), ...Object.keys(afterMd), ...Object.keys(afterHtml)])]
  .sort((a, b) => (before[b] || 0) - (before[a] || 0));
console.log("name before markdown html");
for (const k of keys) console.log(k + " " + (before[k] || 0) + " " + (afterMd[k] || 0) + " " + (afterHtml[k] || 0));
