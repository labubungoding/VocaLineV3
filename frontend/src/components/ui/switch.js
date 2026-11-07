import { html } from '../../lib/dom';

export function switchHtml({ id, checked, label, data = '' }) {
  return html`<button id="${id}" type="button" role="switch" aria-checked="${String(Boolean(checked))}" aria-label="${label}" class="switch" data-switch="${data}"><span></span></button>`;
}
