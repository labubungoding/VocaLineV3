import { html } from '../../../lib/dom';

const BARS = [8, 13, 18, 23, 28];

export function volumeControlHtml(volume) {
  return html`
    <div class="volume">
      <button id="pt-btn-volume-down" type="button" class="btn volume__btn" aria-label="Kecilkan suara" data-action="volume-down">−</button>
      <span id="pt-volume-level" class="volume__meter" role="meter" aria-valuenow="${volume}" aria-valuemin="0" aria-valuemax="100" aria-label="Volume">
        ${BARS.map((h, i) => html`<span class="volume__bar" style="height:${h}px" data-on="${String(volume >= (i + 1) * 20)}"></span>`)}
      </span>
      <button id="pt-btn-volume-up" type="button" class="btn volume__btn" aria-label="Besarkan suara" data-action="volume-up">+</button>
    </div>`;
}
