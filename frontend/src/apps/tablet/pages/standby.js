import { html } from '../../../lib/dom';

export function standbyPageHtml({ bedLabel }) {
  return html`
    <div id="pt-screen" class="standby-screen">
      <div class="standby-screen__ring"><div class="standby-screen__core"></div></div>
      <span id="pt-standby-bed-label" class="pill standby-screen__bed">${bedLabel}</span>
      <h1 id="pt-standby-message" class="standby-screen__title">Menunggu perawat mengaktifkan tablet ini</h1>
      <p class="muted standby-screen__text">Tablet akan menyapa Anda setelah perawat memasukkan data Anda.</p>
    </div>`;
}
