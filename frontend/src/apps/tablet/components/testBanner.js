import { html } from '../../../lib/dom';

const TEXT = {
  mic: ['Tes mikrofon dari perawat', 'Silakan ucapkan sesuatu. Hasilnya muncul di dashboard perawat.'],
  speaker: ['Tes speaker dari perawat', 'Tablet memutar suara contoh selama 3 detik.'],
  alarm: ['Alarm tes dikirim', 'Alarm tes sedang dikirim ke dashboard perawat.'],
};

export function testBannerHtml(type) {
  const [title, desc] = TEXT[type] || ['', ''];
  return html`
    <div id="pt-test-banner" class="test-banner" data-test="${type}">
      <span class="dot test-banner__dot"></span>
      <span class="test-banner__text">
        <b class="test-banner__title">${title}</b>
        <span class="muted test-banner__desc">${desc}</span>
      </span>
    </div>`;
}
