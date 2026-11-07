class Html {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

export function raw(s) {
  return new Html(String(s ?? ''));
}

function value(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof Html) return v.s;
  if (Array.isArray(v)) return v.map(value).join('');
  return esc(v);
}

export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    out += value(v) + strings[i + 1];
  });
  return new Html(out);
}

export function setHtml(el, content) {
  if (!el) return;
  const s = value(content);
  if (el.__html === s) return;
  el.__html = s;
  el.innerHTML = s;
}

export function el(content) {
  const t = document.createElement('template');
  t.innerHTML = value(content).trim();
  return t.content.firstElementChild;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function on(root, type, selector, handler) {
  root.addEventListener(type, (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  });
}

export function go(path) {
  window.location.href = path;
}
