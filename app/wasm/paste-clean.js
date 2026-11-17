// Part of Canela, a live Markdown editor in Hilde.
//
// SPDX-FileCopyrightText: 2026 Heiko Zimmermann
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
// HTML from the clipboard of Word and of Google Docs made plain HTML before
// it goes to the core: Word writes lists as paragraphs with a style
// mso-list and the bullet as text in a conditional comment, Office tags with
// a prefix (o:p), and styles on every run; Google Docs wraps everything in
// <b id="docs-internal-guid-..."> and says bold and italic only through
// styles.  What comes out has lists, strong and em; the core's cleaner takes
// what is left.

function isWord(html) {
  return /urn:schemas-microsoft-com:office|class="?Mso|mso-list|<o:p>/i.test(html);
}

function isGoogleDocs(html) {
  return /id="docs-internal-guid-/.test(html);
}

// Word's list paragraph: its level (1 on) and whether it is numbered.
function listInfo(p) {
  const style = p.getAttribute("style") || "";
  const m = /mso-list:\s*(\S+)\s+level(\d+)/i.exec(style);
  if (!m && !/MsoListParagraph/i.test(p.className || "")) return null;
  const marker = p.querySelector("[data-word-marker]");
  const text = marker ? marker.textContent.trim() : "";
  return { list: m ? m[1] : "", level: m ? Number(m[2]) : 1, ordered: /^(\d+|[a-zA-Z]|[ivxlcdm]+)[.)]$/i.test(text) };
}

function cleanWord(html) {
  // The marker of a list item stands between <!--[if !supportLists]--> and
  // <!--[endif]-->; it is kept in a marked span to tell numbers from bullets.
  let h = html.replace(/<!--\[if !supportLists\]-->([\s\S]*?)<!--\[endif\]-->/gi,
    (all, inner) => "<span data-word-marker>" + inner.replace(/<[^>]*>/g, "") + "</span>");
  h = h.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  h = h.replace(/<\/?[a-z]+:[^>]*>/gi, "");
  const doc = new DOMParser().parseFromString(h, "text/html");
  for (const s of doc.querySelectorAll("span")) {
    if (/mso-list:\s*Ignore/i.test(s.getAttribute("style") || "")) {
      s.setAttribute("data-word-marker", "");
    }
  }
  const body = doc.body;
  // Paragraphs of a list in a row become one list, nested by their level.
  const paragraphs = [...body.querySelectorAll("p")];
  let stack = [];
  let lastParagraph = null;
  let lastList = null;
  for (const p of paragraphs) {
    const info = listInfo(p);
    const follows = lastParagraph && p.previousElementSibling === lastParagraph;
    if (!info) { stack = []; lastParagraph = null; continue; }
    if (!follows || info.list !== lastList) stack = [];
    lastList = info.list;
    while (stack.length > info.level) stack.pop();
    while (stack.length < info.level) {
      const list = doc.createElement(info.ordered ? "ol" : "ul");
      if (stack.length === 0) p.before(list);
      else {
        const parentList = stack[stack.length - 1];
        const lastItem = parentList.lastElementChild || parentList.appendChild(doc.createElement("li"));
        lastItem.append(list);
      }
      stack.push(list);
    }
    const li = doc.createElement("li");
    for (const m of p.querySelectorAll("[data-word-marker]")) m.remove();
    while (p.firstChild) li.append(p.firstChild);
    stack[stack.length - 1].append(li);
    const keep = doc.createElement("span");
    p.replaceWith(keep);
    lastParagraph = keep;
  }
  for (const m of body.querySelectorAll("[data-word-marker]")) m.remove();
  return body;
}

function cleanGoogleDocs(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const b of doc.querySelectorAll("b[id^='docs-internal-guid-']")) b.replaceWith(...b.childNodes);
  for (const s of doc.querySelectorAll("span[style]")) {
    const style = s.getAttribute("style");
    let node = s;
    if (/font-weight:\s*(700|bold)/i.test(style)) {
      const strong = doc.createElement("strong");
      strong.append(...node.childNodes);
      node.append(strong);
    }
    if (/font-style:\s*italic/i.test(style)) {
      const em = doc.createElement("em");
      em.append(...node.childNodes);
      node.append(em);
    }
  }
  return doc.body;
}

// Styles, classes and empty spans go; what is left is structure.
function strip(body) {
  for (const el of body.querySelectorAll("[style], [class], [lang]")) {
    el.removeAttribute("style");
    el.removeAttribute("class");
    el.removeAttribute("lang");
  }
  for (const s of [...body.querySelectorAll("span, font")]) {
    if (s.attributes.length === 0) s.replaceWith(...s.childNodes);
  }
  for (const p of [...body.querySelectorAll("p")]) {
    if (p.textContent.replace(/[\s\u00a0]/g, "") === "" && !p.querySelector("img")) p.remove();
  }
  return body.innerHTML.replace(/\u00a0/g, " ").replace(/ {2,}/g, " ").replace(/ +<\/(p|li|h[1-6])>/g, "</$1>");
}

// The HTML of the clipboard as the core should take it; HTML from elsewhere
// passes unchanged.
export function cleanPastedHtml(html) {
  if (!html) return html;
  if (isWord(html)) return strip(cleanWord(html));
  if (isGoogleDocs(html)) return strip(cleanGoogleDocs(html));
  return html;
}
