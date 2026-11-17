// Part of Canela, a live Markdown editor in Hilde.
//
// SPDX-FileCopyrightText: 2026 Heiko Zimmermann
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
// The exports of canela.wasm in node: HTML in, edits, HTML out.  Each
// check prints one line; the last line counts them.
//
//     node test.mjs canela.wasm

import { readFile } from "node:fs/promises";
import { loadHilde } from "./hilde-wasm.js";

const hilde = await loadHilde(await readFile(process.argv[2]));
const e = hilde.exports;
const enc = new TextEncoder();
const dec = new TextDecoder();

function call(fn, inputs) {
  const mem = () => new Uint8Array(e.memory.buffer);
  const placed = inputs.map((b) => {
    const a = e.hilde_wasm_alloc(Math.max(b.length, 1));
    mem().set(b, a);
    return [a, b.length];
  });
  let room = 64;
  for (;;) {
    const out = e.hilde_wasm_alloc(room);
    const size = fn(placed, out, room) >>> 0;
    const bytes = mem().slice(out, out + size);
    e.hilde_wasm_free(out);
    if (size <= room) {
      for (const [a] of placed) e.hilde_wasm_free(a);
      return bytes;
    }
    room = size;
  }
}

const fromHtml = (mode, html) => call((p, o, r) => e.canela_from_html(mode, ...p[0], o, r), [enc.encode(html)]);
const toHtml = (mode, src) => dec.decode(call((p, o, r) => e.canela_to_html(mode, ...p[0], o, r), [src]));
const edit = (mode, src, a, h, op, n = 0, first = "", second = "") => {
  const bytes = call((p, o, r) => e.canela_edit(mode, ...p[0], a, h, op, n, ...p[1], ...p[2], o, r),
    [src, enc.encode(first), enc.encode(second)]);
  const v = new DataView(bytes.buffer);
  return { anchor: v.getUint32(0, true), head: v.getUint32(4, true), source: bytes.slice(8) };
};

let good = 0;
let bad = 0;
function expect(name, got, want) {
  if (got === want) { good++; console.log("ok   " + name); }
  else { bad++; console.log("FAIL " + name + "\n  got:  " + JSON.stringify(got) + "\n  want: " + JSON.stringify(want)); }
}

const md = fromHtml(0, "<h2>Hi</h2><p>A <strong>b</strong></p><ul><li>x</li></ul>");
expect("html to markdown", dec.decode(md), "## Hi\n\nA **b**\n\n- x\n");
let r = edit(0, md, md.length - 1, md.length - 1, 2);
r = edit(0, r.source, r.head, r.head, 1, 0, "y");
expect("return continues the list", dec.decode(r.source), "## Hi\n\nA **b**\n\n- x\n- y\n");
expect("caret after the typed letter", r.head, r.source.length - 1);
expect("markdown to html", toHtml(0, r.source), "<h2>Hi</h2>\n<p>A <strong>b</strong></p>\n<ul>\n<li>x</li>\n<li>y</li>\n</ul>\n");
r = edit(0, r.source, 0, 0, 6, 1);
expect("heading level 1", dec.decode(r.source).split("\n")[0], "# Hi");
expect("script dropped on the way in", dec.decode(fromHtml(0, "<p>a</p><script>alert(1)</script>")), "a\n");
const unsafe = toHtml(0, enc.encode("[x](javascript:alert(1))\n\n<a href=\"javascript:alert(2)\">y</a>\n"));
expect("no javascript link on the way out (input has two)",
  /href\s*=\s*"?\s*javascript/i.test(unsafe) || !unsafe.includes(">y</a>"), false);
const big = "x".repeat(5000);
expect("long answer through the second call", dec.decode(fromHtml(0, "<p>" + big + "</p>")), big + "\n");
const html = fromHtml(1, '<table><tr><td colspan="2">a</td></tr></table>');
expect("html mode keeps colspan", dec.decode(html).includes('colspan="2"'), true);
const table = call((p, o, r) => e.canela_commands(0, o, r), []);
const tv = new DataView(table.buffer);
let at = 0;
const word = () => { const v = tv.getUint32(at, true); at += 4; return v; };
const text = () => { const n = word(); const s = dec.decode(table.slice(at, at + n)); at += n; return s; };
const names = [];
for (let id = 0, count = word(); id < count; id++) {
  const kind = word(); const style = word();
  const c = { id, kind, style, name: text(), syntax: text(), shortcut: text() };
  names.push(c.name);
  console.log("command " + JSON.stringify(c));
}
expect("command table read to its end", at, table.length);
const plain = enc.encode("one two\n");
r = edit(0, plain, 4, 7, 16, names.indexOf("Bold"));
expect("command Bold wraps the selection", dec.decode(r.source), "one **two**\n");
r = edit(0, plain, 8, 8, 17, 203);
expect("table of 2 columns and 3 rows", dec.decode(r.source).split("\n").filter((l) => l.startsWith("|")).length, 5);
console.log("checks " + (good + bad) + ", good " + good + ", bad " + bad);
process.exit(bad === 0 && good === 12 ? 0 : 1);
