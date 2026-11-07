import { html } from '../../../lib/dom';
import { emergencyButtonHtml } from './emergencyButton';

const MESSAGE = {
  red: 'Bantuan sedang datang. Saya temani dulu, ya.',
  orange: 'Perawat sudah dipanggil. Saya temani dulu, ya.',
};

export function alarmOverlayHtml({ level, status, nurseName, bedId, canCancel }) {
  const lvl = MESSAGE[level] ? level : 'orange';
  return html`
    <div id="pt-overlay-alarm" class="alarm-overlay" data-level="${lvl}">
      <div class="alarm-overlay__content">
        <div class="alarm-overlay__ring"><div class="alarm-overlay__core"></div></div>
        <h1 id="pt-alarm-message" class="alarm-overlay__message">${MESSAGE[lvl]}</h1>
        <p id="pt-alarm-status" class="alarm-overlay__status" data-status="${status}">
          ${status === 'handling' ? `Perawat ${nurseName || ''} sedang menuju kamar` : 'Menunggu perawat'}
        </p>
        ${lvl === 'orange' && canCancel ? html`
          <button id="pt-btn-cancel-alarm" type="button" class="btn alarm-overlay__cancel" data-action="cancel-alarm">Batalkan panggilan</button>` : ''}
      </div>
      ${emergencyButtonHtml({ bedId, sub: 'selalu terlihat', extraClass: 'btn-emergency--corner' })}
    </div>`;
}
