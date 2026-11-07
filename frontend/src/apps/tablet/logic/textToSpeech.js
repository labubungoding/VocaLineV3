let current = null;

function indonesianVoice() {
  return window.speechSynthesis?.getVoices().find((v) => v.lang?.toLowerCase().startsWith('id'));
}

const MULAI_MS = 3000;
const perkiraanMs = (text, rate) => 3000 + ((text || '').length * 110) / Math.max(0.5, rate || 1);

export function speak({ text, rate = 1, pitch = 1, audio = null, volume = 1, onLevel = () => {} }) {
  stopSpeaking();
  if (!text && !audio) return Promise.resolve();
  return new Promise((resolve) => {
    let finished = false;
    let started = false;
    let stopEngine = () => {};
    const timers = [];
    const done = () => {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      clearInterval(pulse);
      onLevel(0);
      current = null;
      resolve();
    };
    const giveUp = () => {
      stopEngine();
      done();
    };
    const onStart = () => {
      started = true;
      timers.push(setTimeout(giveUp, perkiraanMs(text, rate) + (audio ? 30000 : 0)));
    };
    timers.push(setTimeout(() => { if (!started) giveUp(); }, MULAI_MS));
    const pulse = setInterval(() => onLevel(0.3 + Math.random() * 0.5), 120);

    if (audio) {
      const el = new Audio(`data:audio/wav;base64,${audio}`);
      el.volume = volume;
      el.onplaying = onStart;
      el.onended = done;
      el.onerror = done;
      stopEngine = () => el.pause();
      current = { stop: () => { el.pause(); done(); } };
      el.play().catch(done);
      return;
    }
    if (!window.speechSynthesis) return done();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'id-ID';
    u.rate = rate;
    u.pitch = pitch;
    u.volume = volume;
    const voice = indonesianVoice();
    if (voice) u.voice = voice;
    u.onstart = onStart;
    u.onend = done;
    u.onerror = done;
    stopEngine = () => window.speechSynthesis.cancel();
    current = { stop: () => { window.speechSynthesis.cancel(); done(); } };
    window.speechSynthesis.speak(u);
  });
}

const clamp = (v, range, fallback) => {
  const n = Number.isFinite(v) ? v : fallback;
  return Math.min(range?.maks ?? Infinity, Math.max(range?.min ?? -Infinity, n));
};

export function voiceTone(settings, { expression = 'netral', persona, baseRate = 1, extraRate = 1 } = {}) {
  const ex = settings?.ekspresi?.[expression] || settings?.ekspresi?.netral || { pitch: 1, rate: 1 };
  const pe = (persona && settings?.persona?.[persona]) || { pitch: 0, rate: 1 };
  const rate = (baseRate || 1) * (ex.rate ?? 1) * (pe.rate ?? 1) * (extraRate || 1);
  const pitch = (ex.pitch ?? 1) + (pe.pitch ?? 0);
  return {
    rate: clamp(rate, settings?.batas?.rate || { min: 0.5, maks: 2 }, 1),
    pitch: clamp(pitch, settings?.batas?.pitch || { min: 0, maks: 2 }, 1),
  };
}

export function stopSpeaking() {
  current?.stop();
  current = null;
}

export const isSpeaking = () => Boolean(current);
