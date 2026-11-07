import { html, setHtml } from '../../../lib/dom';
import { getDb } from '../../../lib/realtime';
import { openModal } from '../../../components/ui/modal';
import { bedName } from '../../../services/rooms';
import { checkDeviceLive, pairTablet, validateDeviceId, DEVICE_ID_PATTERN } from '../../../services/tablets';
import { toast } from '../../../store/uiStore';

const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm';
let jsQrLoader = null;

async function createQrReader() {
  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats?.();
      if (!formats || formats.includes('qr_code')) {
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        return async (video) => (await detector.detect(video).catch(() => [])).map((c) => c.rawValue);
      }
    } catch {
    }
  }
  jsQrLoader = jsQrLoader || import( JSQR_URL).then((m) => {
    const fn = [m.default?.default, m.default, m.jsQR].find((f) => typeof f === 'function');
    if (!fn) throw new Error('jsQR tidak ditemukan');
    return fn;
  });
  const jsQR = await jsQrLoader.catch((e) => {
    jsQrLoader = null;
    throw e;
  });
  const canvas = document.createElement('canvas');
  const c2d = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return [];
    const scale = Math.min(1, 720 / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    c2d.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = c2d.getImageData(0, 0, canvas.width, canvas.height);
    const found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
    return found ? [found.data] : [];
  };
}

function startQrScanner(video, { onResult, onFail }) {
  let stream;
  let stop = false;
  (async () => {
    let read;
    try {
      read = await createQrReader();
    } catch {
      if (!stop) onFail('Pembaca QR tidak bisa dimuat (periksa internet). Ketik ID perangkat saja.');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      if (stop) return stream.getTracks().forEach((t) => t.stop());
      video.srcObject = stream;
      await video.play();
      while (!stop) {
        const codes = await read(video).catch(() => []);
        const hit = codes.map((c) => String(c).trim().toUpperCase()).find((v) => DEVICE_ID_PATTERN.test(v));
        if (hit) return onResult(hit);
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch {
      if (!stop) onFail('Kamera tidak bisa dibuka. Izinkan kamera, atau ketik ID perangkat saja.');
    }
  })();
  return () => {
    stop = true;
    stream?.getTracks().forEach((t) => t.stop());
  };
}

export function openPairTabletModal({ bedId, mode = 'pair', onClose }) {
  const db = getDb();
  const replace = mode === 'replace';
  const bed = db.beds.find((b) => b.id === bedId);
  const oldTablet = db.tablets.find((t) => t.id === bed?.tabletId);
  let stopScan = null;

  const m = openModal({
    id: 'nr-modal-pair-tablet',
    subtitle: bedName(db, bedId),
    title: replace ? 'Ganti tablet' : 'Daftarkan & pasangkan tablet',
    maxWidth: 540,
    onClose: () => {
      stopScan?.();
      onClose?.();
    },
    body: html`
      ${replace && oldTablet ? html`
        <p class="alert alert--info">
          Tablet lama ${oldTablet.label} dilepas dari kasur ini. Data pasien ikut pindah ke tablet baru, tidak perlu diisi ulang.
        </p>` : ''}
      <div id="nr-pair-scan-area">
        <button id="nr-btn-scan-qr" type="button" class="btn btn--primary pair__scan">Pindai QR di layar tablet</button>
      </div>
      <div class="muted pair__divider"><span></span>atau ketik ID perangkat<span></span></div>
      <label class="lbl">
        ID perangkat
        <input id="nr-input-device-id" class="fi mono" placeholder="TAB-7F3K-92QD" />
      </label>
      <div id="nr-pair-feedback"></div>
      <p class="muted pair__hint">ID tertulis di layar tablet yang belum terpasang (buka /tablet di perangkat itu).</p>
      <div class="modal__actions">
        <button id="nr-btn-cancel-pair" type="button" class="btn">Batal</button>
        <button id="nr-btn-confirm-pair" type="button" class="btn btn--primary" disabled>${replace ? 'Ganti tablet' : 'Daftarkan & pasangkan'}</button>
      </div>`,
  });

  const $ = (id) => m.root.querySelector(id);
  const input = $('#nr-input-device-id');
  const confirmBtn = $('#nr-btn-confirm-pair');
  const scanArea = $('#nr-pair-scan-area');

  const check = () => {
    const current = getDb();
    const v = input.value.trim().toUpperCase();
    const error = v ? validateDeviceId(current, v, bedId) : null;
    const ok = Boolean(v && !error);
    const isNew = ok && !current.tablets.some((t) => t.deviceId === v);
    confirmBtn.disabled = !ok;
    setHtml($('#nr-pair-feedback'), error
      ? html`<p id="nr-pair-error" role="alert" class="alert alert--error">${error}</p>`
      : ok
        ? html`<p id="nr-pair-found" class="alert alert--ok">${isNew ? `Tablet baru ${v} akan didaftarkan dan dipasangkan ke kasur ini.` : `Tablet ${v} akan dipasangkan ke kasur ini.`}</p>`
        : '');
    return ok ? v : null;
  };

  let saving = false;
  const showServerError = (message) => {
    setHtml($('#nr-pair-feedback'), html`<p id="nr-pair-error" role="alert" class="alert alert--error">${message}</p>`);
  };
  const confirm = async () => {
    const v = check();
    if (!v || saving) return;
    stopScan?.();
    saving = true;
    confirmBtn.disabled = true;
    const err = (await checkDeviceLive(v, bedId)) || (await pairTablet(v, bedId));
    saving = false;
    if (err) {
      confirmBtn.disabled = false;
      return showServerError(err);
    }
    toast(replace ? 'Tablet diganti. Data pasien ikut pindah.' : `Tablet ${v} dipasangkan ke ${bedName(getDb(), bedId)}`, 'success');
    m.dismiss();
  };

  const showScanButton = () => {
    stopScan?.();
    stopScan = null;
    setHtml(scanArea, html`<button id="nr-btn-scan-qr" type="button" class="btn btn--primary pair__scan">Pindai QR di layar tablet</button>`);
  };

  scanArea.addEventListener('click', (e) => {
    if (e.target.closest('#nr-btn-scan-qr')) {
      if (!navigator.mediaDevices?.getUserMedia) return toast('Browser ini tidak bisa membuka kamera. Ketik ID perangkat di bawah.', 'error');
      setHtml(scanArea, html`
        <div class="pair__scanner">
          <video muted playsinline class="pair__video"></video>
          <button type="button" class="btn btn--ghost" data-action="cancel-scan">Batal memindai</button>
        </div>`);
      stopScan = startQrScanner(scanArea.querySelector('video'), {
        onResult: (id) => {
          input.value = id;
          showScanButton();
          check();
        },
        onFail: (message) => {
          toast(message, 'error');
          showScanButton();
        },
      });
    }
    if (e.target.closest('[data-action="cancel-scan"]')) showScanButton();
  });

  input.addEventListener('input', check);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && confirm());
  confirmBtn.addEventListener('click', confirm);
  $('#nr-btn-cancel-pair').addEventListener('click', m.dismiss);
}
