import { html, raw } from '../../../lib/dom';

export function setupPageHtml({ deviceId, disabled, online, qrSvg }) {
  return html`
    <div id="pt-screen" class="setup-screen">
      <div class="setup-screen__intro">
        <span class="cap">Tablet belum siap dipakai pasien</span>
        <h1 id="pt-setup-status" class="setup-screen__title" data-status="${disabled ? 'disabled' : 'unregistered'}">
          ${disabled ? 'Tablet ini dinonaktifkan admin' : 'Tablet belum terpasang di kasur'}
        </h1>
        <p class="muted setup-screen__text">
          ${disabled
            ? 'Hubungi admin rumah sakit untuk mengaktifkan tablet ini lagi.'
            : 'Minta perawat bangsal memindai QR ini dari dashboard. Tablet akan langsung terdaftar dan terpasang ke kasur.'}
        </p>
      </div>

      <div class="setup-screen__device">
        <span id="pt-device-qr" class="setup-screen__qr" aria-label="QR ID perangkat">${raw(qrSvg || '')}</span>
        <div class="setup-screen__id-box">
          <div>
            <span class="cap">ID perangkat</span>
            <div id="pt-device-id" class="mono setup-screen__id">${deviceId}</div>
          </div>
          <span id="pt-connection-status" class="pill setup-screen__conn" data-status="${online ? 'online' : 'offline'}">
            <span class="dot"></span>
            ${online ? 'Terhubung ke server' : 'Tidak terhubung'}
          </span>
        </div>
      </div>

      <ol class="setup-screen__steps">
        <li class="card"><b>1. Dipindai perawat</b><br /><span class="muted">tablet langsung terdaftar dan terpasang ke kasur</span></li>
        <li class="card"><b>2. Diuji perawat</b><br /><span class="muted">mikrofon, speaker, dan alarm tes dari dashboard</span></li>
      </ol>
    </div>`;
}
