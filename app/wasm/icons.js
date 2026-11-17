// Part of Canela, a live Markdown editor in Hilde.
//
// SPDX-FileCopyrightText: 2026 Heiko Zimmermann
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
// The symbols of the toolbar: small SVG drawings in the colour of the text
// (currentColor), 20 by 20, drawn for Canela.  A button shows its symbol;
// its name stays its tooltip and the name a screen reader reads.

const S = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
const T = 'fill="currentColor" font-family="system-ui, sans-serif" text-anchor="middle"';

const SHAPES = {
  bold: `<text x="10" y="15" ${T} font-size="14" font-weight="700">B</text>`,
  italic: `<text x="10" y="15" ${T} font-size="14" font-style="italic" font-family="Georgia, serif">I</text>`,
  strikethrough: `<text x="10" y="15" ${T} font-size="14">S</text><path ${S} d="M4 10.5h12"/>`,
  code: `<path ${S} d="M7.5 6 4 10l3.5 4M12.5 6 16 10l-3.5 4"/>`,
  highlight: `<path ${S} d="M5 15h10M7 12l5-7 3 2-5 7H7z"/>`,
  link: `<path ${S} d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1-1"/>`,
  bulletedList: `<circle cx="4.5" cy="6" r="1.2" fill="currentColor"/><circle cx="4.5" cy="10" r="1.2" fill="currentColor"/><circle cx="4.5" cy="14" r="1.2" fill="currentColor"/><path ${S} d="M8 6h8M8 10h8M8 14h8"/>`,
  numberedList: `<text x="4.5" y="8" ${T} font-size="5.5">1</text><text x="4.5" y="15.5" ${T} font-size="5.5">2</text><path ${S} d="M8 6h8M8 13.5h8"/>`,
  todoList: `<rect ${S} x="3" y="4" width="6" height="6" rx="1"/><path ${S} d="M4.3 7l1.3 1.3L8 5.6M11 7h6M3.5 13.5h5M11 14h6"/>`,
  blockQuote: `<path ${S} d="M5 7h3v3c0 2-1 3-3 3.5M11 7h3v3c0 2-1 3-3 3.5"/>`,
  codeBlock: `<rect ${S} x="3" y="4" width="14" height="12" rx="1.5"/><path ${S} d="M7.5 8 5.8 10l1.7 2M12.5 8l1.7 2-1.7 2"/>`,
  insertTable: `<rect ${S} x="3" y="4" width="14" height="12" rx="1"/><path ${S} d="M3 8h14M3 12h14M8 4v12M12.5 4v12"/>`,
  horizontalLine: `<path ${S} d="M3 10h14"/><path ${S} stroke-opacity=".45" d="M5 6h10M5 14h10"/>`,
  image: `<rect ${S} x="3" y="4.5" width="14" height="11" rx="1.5"/><circle cx="7.5" cy="8.5" r="1.3" fill="currentColor"/><path ${S} d="m4 14 4-4 3 3 2-2 3 3"/>`,
  undo: `<path ${S} d="M8 6 4.5 9.5 8 13M5 9.5h7a4 4 0 0 1 0 8h-2"/>`,
  redo: `<path ${S} d="M12 6l3.5 3.5L12 13M15 9.5H8a4 4 0 0 0 0 8h2"/>`,
  sourceEditing: `<path ${S} d="M7 5 3.5 10 7 15M13 5l3.5 5L13 15M11.2 4.5 8.8 15.5"/>`,
  // The tools of a table, by the English name of the core's command.
  "Add Row Below": `<rect ${S} x="3" y="3.5" width="14" height="7" rx="1"/><path ${S} d="M10 12.5v5M7.5 15h5"/>`,
  "Add Column Right": `<rect ${S} x="3" y="3" width="7" height="14" rx="1"/><path ${S} d="M15 7.5v5M12.5 10h5"/>`,
  "Delete Row": `<rect ${S} x="3" y="3.5" width="14" height="7" rx="1"/><path ${S} d="M7.5 15h5"/>`,
  "Delete Column": `<rect ${S} x="3" y="3" width="7" height="14" rx="1"/><path ${S} d="M12.5 10h5"/>`,
  "Align Column Left": `<path ${S} d="M4 5h12M4 9h8M4 13h12M4 17h8"/>`,
  "Align Column Center": `<path ${S} d="M4 5h12M6 9h8M4 13h12M6 17h8"/>`,
  "Align Column Right": `<path ${S} d="M4 5h12M8 9h8M4 13h12M8 17h8"/>`,
};

// The symbol of a toolbar item as an SVG element, or null when it has none.
export function icon(name) {
  const shape = SHAPES[name];
  if (!shape) return null;
  const holder = document.createElement("span");
  holder.innerHTML = `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">${shape}</svg>`;
  return holder.firstChild;
}
