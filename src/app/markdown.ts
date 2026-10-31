/**
 * A small Markdown reader for the assistant's replies (ADR 0016): paragraphs,
 * headings, bullet and numbered lists, fenced code, and inline bold, italic
 * and code. It builds DOM nodes and never sets HTML, so a reply cannot inject
 * markup (AGENTS.md). Plain text goes through `text`, so the caller can mark
 * figures in it (NFR-HON-002).
 */

type TextFn = (text: string) => Node[];

const plain: TextFn = (t) => [document.createTextNode(t)];

/** Inline marks: `code`, **bold**, *italic* or _italic_ (not inside words, so ids like water_tank stay). */
const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(\*[^*\s][^*\n]*?\*)|((?<![\w])_[^_\s][^_\n]*?_(?![\w]))/g;

function inline(src: string, text: TextFn): Node[] {
  const out: Node[] = [];
  let last = 0;
  for (const m of src.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(...text(src.slice(last, at)));
    const tok = m[0];
    if (m[1]) {
      const c = document.createElement('code');
      c.textContent = tok.slice(1, -1);
      out.push(c);
    } else {
      const strong = !!m[2];
      const e = document.createElement(strong ? 'strong' : 'em');
      e.append(...inline(tok.slice(strong ? 2 : 1, strong ? -2 : -1), text));
      out.push(e);
    }
    last = at + tok.length;
  }
  if (last < src.length) out.push(...text(src.slice(last)));
  return out;
}

/** Lines joined within a paragraph or item, with their line breaks kept. */
function lines(ls: string[], text: TextFn): Node[] {
  const out: Node[] = [];
  ls.forEach((l, i) => {
    if (i) out.push(document.createElement('br'));
    out.push(...inline(l, text));
  });
  return out;
}

const BULLET = /^\s*[-*•]\s+/;
const NUMBER = /^\s*\d+[.)]\s+/;
const HEADING = /^(#{1,4})\s+(.*)$/;

/** Render Markdown as a fragment of DOM nodes. */
export function renderMarkdown(src: string, text: TextFn = plain): DocumentFragment {
  const frag = document.createDocumentFragment();
  const all = src.replace(/\r\n/g, '\n').split('\n');
  let para: string[] = [];
  let list: { el: HTMLOListElement | HTMLUListElement; items: string[][] } | null = null;

  const endPara = () => {
    if (!para.length) return;
    const p = document.createElement('p');
    p.append(...lines(para, text));
    frag.append(p);
    para = [];
  };
  const endList = () => {
    if (!list) return;
    for (const item of list.items) {
      const li = document.createElement('li');
      li.append(...lines(item, text));
      list.el.append(li);
    }
    frag.append(list.el);
    list = null;
  };

  for (let i = 0; i < all.length; i++) {
    const line = all[i]!;
    if (/^\s*```/.test(line)) {
      endPara();
      endList();
      const code: string[] = [];
      for (i++; i < all.length && !/^\s*```/.test(all[i]!); i++) code.push(all[i]!);
      const pre = document.createElement('pre');
      const c = document.createElement('code');
      c.textContent = code.join('\n');
      pre.append(c);
      frag.append(pre);
      continue;
    }
    if (!line.trim()) {
      endPara();
      endList();
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      endPara();
      endList();
      const e = document.createElement('h4');
      e.append(...inline(h[2]!, text));
      frag.append(e);
      continue;
    }
    const bullet = BULLET.test(line);
    const number = !bullet && NUMBER.test(line);
    if (bullet || number) {
      endPara();
      const tag = bullet ? 'ul' : 'ol';
      if (list && list.el.tagName.toLowerCase() !== tag) endList();
      list ??= { el: document.createElement(tag), items: [] };
      list.items.push([line.replace(bullet ? BULLET : NUMBER, '')]);
      continue;
    }
    // An indented line after an item continues it; anything else is a paragraph.
    if (list && /^\s+/.test(line)) {
      list.items.at(-1)!.push(line.trim());
      continue;
    }
    endList();
    para.push(line);
  }
  endPara();
  endList();
  return frag;
}
