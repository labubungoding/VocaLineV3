import { finishTabletTest, heartbeat } from '../../../services/tablets';
import { raiseTestAlarm } from '../../../services/alarms';
import { isLive } from '../../../lib/supabase';

const RESULTS = {
  mic: 'Mikrofon lulus · suara terdeteksi jelas',
  speaker: 'Speaker diputar · pastikan suara terdengar di kamar',
  alarm: 'Alarm tes diterima dashboard dalam 1 detik',
};

async function runTest(test) {
  if (test.type === 'alarm') {
    await raiseTestAlarm(test.id);
    return;
  }
  if (test.type === 'mic') {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      finishTabletTest(test.id, true, 'Mikrofon bisa dipakai');
    } catch {
      finishTabletTest(test.id, false, 'Mikrofon tidak bisa dibuka (izin ditolak atau tidak ada)');
    }
    return;
  }
  const ok = Boolean(window.speechSynthesis);
  if (ok) {
    const u = new SpeechSynthesisUtterance('Tes suara. Halo, saya Vine.');
    u.lang = 'id-ID';
    window.speechSynthesis.speak(u);
  }
  finishTabletTest(test.id, ok, ok ? RESULTS.speaker : 'Speaker/suara browser tidak tersedia');
}

async function battery() {
  try {
    const b = await navigator.getBattery?.();
    return b ? Math.round(b.level * 100) : undefined;
  } catch {
    return undefined;
  }
}

export function createTabletChannel() {
  let currentDevice = null;
  let beat = null;
  let testId = null;
  let testTimer = null;

  return {
    update(deviceId, db) {
      if (deviceId !== currentDevice) {
        currentDevice = deviceId;
        clearInterval(beat);
        const beatNow = async () => heartbeat(deviceId, isLive ? await battery() : undefined);
        setTimeout(beatNow, 0);
        beat = setInterval(beatNow, 30 * 1000);
      }

      const test = db.commands.find((c) => c.deviceId === deviceId && c.status === 'pending') || null;
      if ((test?.id || null) !== testId) {
        clearTimeout(testTimer);
        testId = test?.id || null;
        if (test && isLive) runTest(test);
        else if (test) testTimer = setTimeout(() => finishTabletTest(test.id, true, RESULTS[test.type]), 3000);
      }
      return test;
    },
  };
}
