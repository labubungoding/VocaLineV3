import { html } from '../../../lib/dom';
import { aiAvatarHtml, AI_STATES } from '../components/aiAvatar';
import { volumeControlHtml } from '../components/volumeControl';
import { emergencyButtonHtml } from '../components/emergencyButton';

export const EMOTIONS = {
  neutral: ['Netral', 'Siang ini cerah ya, Sus.', 'Iya, Bu. Matahari siang ini hangat. Ibu mau ngobrol soal apa?'],
  angry: ['Marah', 'Kenapa sih perawatnya lama sekali, saya sudah panggil dari tadi!', 'Saya mengerti Ibu kesal karena menunggu. Saya bantu panggilkan perawat sekarang, ya.'],
  happy: ['Senang', 'Tadi saya sudah bisa jalan sendiri ke kamar mandi!', 'Wah, kabar bagus sekali, Bu! Itu kemajuan besar. Selamat, ya!'],
  sad: ['Sedih', 'Saya kangen anak-anak di rumah, sudah seminggu di sini.', 'Wajar sekali merasa rindu, Bu. Mau cerita sedikit tentang anak-anak Ibu?'],
};

export function emotionPageHtml({ emotion = 'neutral', greeting, said, reply, bedId, volume, aiState = 'speaking' }) {
  const key = EMOTIONS[emotion] ? emotion : 'neutral';
  const [label, sampleSaid, sampleReply] = EMOTIONS[key];
  const listening = aiState === 'listening';
  return html`
    <div id="pt-screen" class="emotion-screen" data-emotion="${key}">
      <div class="talk-screen__top">
        <h1 id="pt-greeting" class="talk-screen__greeting">${greeting}</h1>
        <span id="pt-listening-indicator" class="pill talk-screen__listening" data-listening="${String(listening)}"><span class="dot"></span>${AI_STATES[aiState]?.text || AI_STATES.speaking.text}</span>
        ${volumeControlHtml(volume)}
      </div>

      <div class="emotion-screen__center">
        <div class="emotion-screen__avatar">
          ${aiAvatarHtml({ state: aiState, emotion: key })}
          <span id="pt-emotion-chip" class="pill emotion-screen__chip">${label}</span>
        </div>
        <div id="pt-response-panel" class="emotion-screen__panel" data-emotion="${key}">
          <p id="pt-patient-utterance" class="emotion-screen__said">"${said || sampleSaid}"</p>
          <p id="pt-caption" class="emotion-screen__reply">${reply || sampleReply}</p>
        </div>
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
