import { html } from '../../../lib/dom';
import { emergencyButtonHtml } from '../components/emergencyButton';

export function aiOffPageHtml({ bedLabel, bedId, waking = false }) {
  return html`
    <div id="pt-screen" class="aioff-screen" data-ai="${waking ? 'waking' : 'off'}">
      <div class="aioff-screen__top">
        <span class="aioff-screen__bed">${bedLabel}</span>
        <span id="pt-wake-indicator" class="pill aioff-screen__wake" data-listening="wake-word" data-waking="${String(waking)}">
          <span class="dot"></span>
          ${waking ? 'Kata "Vine" terdeteksi' : 'Hanya mendengar kata "Vine"'}
        </span>
      </div>

      <div class="aioff-screen__center">
        <div class="aioff-screen__icon">
          <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="#6b7a7c" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16" />
          </svg>
        </div>
        <h1 id="pt-ai-off-title" class="aioff-screen__title">AI sedang dimatikan</h1>
        <p class="muted aioff-screen__text">
          Tablet tidak mendengarkan percakapan. Ucapkan "Vine" atau tekan tombol di bawah untuk menyalakan AI kembali.
        </p>
        ${waking ? html`<p id="pt-wake-detected" class="alert alert--info aioff-screen__detected">Terdengar "Vine" · menyalakan AI…</p>` : ''}
        <button id="pt-btn-ai-on" type="button" class="aioff-screen__on" data-action="ai-on">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0" /></svg>
          Nyalakan AI
        </button>
      </div>

      <div class="talk-screen__bottom">
        <p class="aioff-screen__note">
          Selama AI nonaktif, permintaan bantuan lewat suara tidak terdeteksi. Pakai tombol darurat jika butuh perawat.
        </p>
        <span class="talk-screen__spacer"></span>
        ${emergencyButtonHtml({ bedId, sub: 'tetap aktif' })}
      </div>
    </div>`;
}
