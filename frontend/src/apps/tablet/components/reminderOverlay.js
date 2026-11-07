import { html } from '../../../lib/dom';
import { emergencyButtonHtml } from './emergencyButton';

export function reminderOverlayHtml({ time, text, bedId }) {
  return html`
    <div id="pt-overlay-reminder" class="reminder-overlay">
      <div class="reminder-overlay__card">
        <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="#0f6e74" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="13" r="7" />
          <path d="M12 9v4l2.5 2M9 3h6" />
        </svg>
        <span class="cap reminder-overlay__time">Pengingat · ${time}</span>
        <p id="pt-reminder-text" class="reminder-overlay__text">${text}</p>
        <button id="pt-btn-reminder-ok" type="button" class="btn btn--primary btn--block reminder-overlay__ok" data-action="reminder-ok">Oke</button>
      </div>
      ${emergencyButtonHtml({ bedId, sub: 'selalu terlihat', extraClass: 'btn-emergency--corner' })}
    </div>`;
}
