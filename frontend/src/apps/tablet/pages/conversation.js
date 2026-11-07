import { html } from '../../../lib/dom';
import { aiAvatarHtml, AI_STATES } from '../components/aiAvatar';
import { volumeControlHtml } from '../components/volumeControl';
import { emergencyButtonHtml } from '../components/emergencyButton';

export function conversationPageHtml({ greeting, caption, aiState, situation, offline, bedId, volume, emotion = 'neutral' }) {
  const listening = aiState === 'listening';
  let text = caption;
  if (situation === 'tanya-ulang') text = '…';
  if (situation === 'tawarkan-perawat') text = 'Saya tidak bisa memberi saran obat. Mau saya panggilkan perawat?';

  return html`
    <div id="pt-screen" class="talk-screen">
      ${offline ? html`
        <div id="pt-offline-banner" role="alert" class="alert alert--warn talk-screen__offline">
          Koneksi terputus. Tombol darurat tetap aktif, alarm akan dikirim saat tersambung.
        </div>` : ''}

      <div class="talk-screen__top">
        <h1 id="pt-greeting" class="talk-screen__greeting">${greeting}</h1>
        <span id="pt-listening-indicator" class="pill talk-screen__listening" data-listening="${String(listening)}">
          <span class="dot"></span>
          ${listening ? 'Mendengarkan' : AI_STATES[aiState]?.text}
        </span>
        ${volumeControlHtml(volume)}
      </div>

      <div class="talk-screen__center">
        ${aiAvatarHtml({ state: aiState, emotion })}
        <p id="pt-caption" class="talk-screen__caption" aria-live="polite">${text}</p>
        ${situation === 'tanya-ulang' ? html`
          <p id="pt-retry-hint" class="talk-screen__retry">Maaf, bisa diulang? (tanya ulang ke-1 dari 2)</p>` : ''}
        ${situation === 'tawarkan-perawat' ? html`
          <div class="talk-screen__offer">
            <button id="pt-btn-call-nurse" type="button" class="btn btn--primary btn--tablet" data-action="call-nurse">Ya, panggil perawat</button>
            <button id="pt-btn-decline-nurse" type="button" class="btn btn--ghost btn--tablet" data-action="decline-nurse">Tidak perlu</button>
          </div>` : ''}
      </div>

      <div class="talk-screen__bottom">
        <button id="pt-btn-repeat" type="button" class="btn btn--tablet">Ulangi</button>
        <button id="pt-btn-stop-speaking" type="button" class="btn btn--tablet">Berhenti bicara</button>
        <button id="pt-btn-ai-off" type="button" class="btn btn--tablet btn--ai-off" data-action="ai-off">Matikan AI</button>
        <span class="talk-screen__spacer"></span>
        ${emergencyButtonHtml({ bedId })}
      </div>
    </div>`;
}
