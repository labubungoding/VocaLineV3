import { html } from '../../../lib/dom';

export function demoSelectHtml(label, name, value, options) {
  return html`
    <label>
      ${label}
      <select class="demo-bar__select" data-demo="${name}">
        ${options.map(([v, l]) => html`<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`)}
      </select>
    </label>`;
}

export function demoBarHtml({ open, beds, bedId, screen, screens, extra }) {
  return html`
    <div class="demo-bar" aria-label="Panel demo">
      <button type="button" class="demo-bar__select demo-bar__toggle" data-action="demo-toggle">${open ? 'Demo ▾' : 'Demo ▸'}</button>
      ${open ? html`
        ${demoSelectHtml('Kasur', 'bedId', bedId, beds.map((b) => [b.id, b.label]))}
        ${demoSelectHtml('Layar', 'screen', screen, screens)}
        ${extra}` : ''}
    </div>`;
}
