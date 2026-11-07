import { html } from '../../lib/dom';

export function tabsHtml({ id, options, value, role = 'tab', label }) {
  const groupRole = role === 'tab' ? 'tablist' : 'radiogroup';
  return html`
    <div id="${id}" role="${groupRole}" aria-label="${label}" class="seg-group">
      ${options.map((o) => {
        const on = String(o.value === value);
        return role === 'tab'
          ? html`<button type="button" role="tab" class="seg" data-value="${o.value}" aria-selected="${on}">${o.label}</button>`
          : html`<button type="button" role="radio" class="seg" data-value="${o.value}" aria-checked="${on}">${o.label}</button>`;
      })}
    </div>`;
}

export function bindTabs(container, onChange) {
  container.addEventListener('click', (e) => {
    const b = e.target.closest('.seg[data-value]');
    if (b && container.contains(b)) onChange(b.dataset.value);
  });
}
