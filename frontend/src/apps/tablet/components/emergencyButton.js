import { html } from '../../../lib/dom';
import { createAlarm } from '../../../services/alarms';
import { toast } from '../../../store/uiStore';

const HOLD_MS = 1000;

export function emergencyButtonHtml({ bedId, sub = 'tahan 1 detik', extraClass = '' }) {
  return html`
    <button id="pt-btn-emergency" type="button" class="btn-emergency ${extraClass}" aria-label="Darurat, tahan 1 detik" data-bed="${bedId || ''}">
      DARURAT
      <small>${sub}</small>
      <span class="hold" aria-hidden="true"><span></span></span>
    </button>`;
}

function send(bedId) {
  if (bedId) createAlarm({ bedId, level: 'red', summary: 'Tombol darurat ditekan' });
  else toast('Tablet belum terpasang ke kasur', 'error');
}

export function bindEmergencyButtons(root) {
  let btn = null;
  let start = 0;
  let raf = 0;

  const bar = () => btn?.querySelector('.hold span');
  const stop = () => {
    cancelAnimationFrame(raf);
    const b = bar();
    if (b) b.style.width = '0%';
    btn = null;
  };

  const tick = () => {
    const p = Math.min(1, (performance.now() - start) / HOLD_MS);
    const b = bar();
    if (b) b.style.width = `${p * 100}%`;
    if (p >= 1) {
      const done = btn;
      send(done.dataset.bed);
      btn = null;
      setTimeout(() => {
        const s = done.querySelector('.hold span');
        if (s) s.style.width = '0%';
      }, 400);
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  const begin = (target) => {
    cancelAnimationFrame(raf);
    btn = target;
    start = performance.now();
    raf = requestAnimationFrame(tick);
  };

  root.addEventListener('pointerdown', (e) => {
    const target = e.target.closest('.btn-emergency');
    if (!target) return;
    e.preventDefault();
    begin(target);
  });
  root.addEventListener('pointerout', (e) => {
    if (btn && e.target.closest('.btn-emergency') === btn && !btn.contains(e.relatedTarget)) stop();
  });
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);

  root.addEventListener('keydown', (e) => {
    const target = e.target.closest('.btn-emergency');
    if (!target || e.repeat || !(e.key === ' ' || e.key === 'Enter')) return;
    e.preventDefault();
    begin(target);
  });
  root.addEventListener('keyup', (e) => {
    if (e.target.closest('.btn-emergency')) stop();
  });
}
