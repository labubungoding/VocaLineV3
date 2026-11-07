import { html } from '../../../lib/dom';
import { tabletStatus, STATUS_TEXT } from '../../../services/tablets';

const TESTS = [
  ['mic', 'Tes mikrofon', 'nr-btn-test-mic'],
  ['speaker', 'Tes speaker', 'nr-btn-test-speaker'],
  ['alarm', 'Alarm tes', 'nr-btn-test-alarm'],
];

export function tabletPanelHtml(db, bed) {
  const tablet = db.tablets.find((t) => t.id === bed.tabletId);
  if (!tablet) return '';
  const status = tabletStatus(tablet);
  const cmd = db.commands.find((c) => c.deviceId === tablet.deviceId);

  let result = { text: 'Belum ada tes. Lakukan tes saat berada di dekat kasur.', status: 'idle' };
  if (cmd?.status === 'pending') result = { text: 'Menunggu jawaban tablet…', status: 'pending' };
  else if (cmd?.status === 'pass') result = { text: cmd.result, status: 'pass' };
  else if (cmd?.status === 'fail') result = { text: cmd.result, status: 'fail' };

  return html`
    <section id="nr-bed-tablet-panel" class="tablet-panel">
      <div class="tablet-panel__head">
        <span class="cap tablet-panel__title">Tablet</span>
        <button id="nr-btn-replace-tablet" type="button" class="btn btn--ghost btn--sm" data-action="replace-tablet">Ganti tablet</button>
      </div>
      <div id="nr-bed-tablet-status" class="tablet-panel__status" data-status="${status}">
        <span class="dot"></span>
        ${tablet.label} ${STATUS_TEXT[status].toLowerCase()} · baterai ${tablet.battery}%
      </div>
      <div class="tablet-panel__tests">
        ${TESTS.map(([type, label, id]) => html`
          <button id="${id}" type="button" class="btn btn--sm" data-action="test" data-test="${type}" data-device="${tablet.deviceId}" ${cmd?.status === 'pending' ? 'disabled' : ''}>${label}</button>`)}
      </div>
      <p id="nr-tablet-test-result" class="tablet-panel__result" data-status="${result.status}">${result.text}</p>
    </section>`;
}
