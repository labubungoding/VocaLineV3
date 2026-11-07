import { html } from '../../../lib/dom';

export function endedPageHtml({ message, left, seconds = 5 }) {
  return html`
    <div id="pt-screen" class="ended-screen">
      <div class="ended-screen__check">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#2a7a43" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </div>
      <div id="pt-ended-message" class="ended-screen__message">
        <h1 class="ended-screen__title">${message}</h1>
        <p class="muted ended-screen__text">Sesi berakhir. Semua obrolan sudah dihapus dari tablet ini.</p>
      </div>
      <div class="ended-screen__track">
        <div class="ended-screen__bar" style="width:${((seconds - left) / seconds) * 100}%"></div>
      </div>
      <span class="muted ended-screen__count">Kembali ke layar menunggu dalam ${left} detik</span>
    </div>`;
}
