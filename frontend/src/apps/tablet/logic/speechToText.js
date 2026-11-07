const DEFAULTS = { silenceMs: 1200, minSpeechMs: 400, minBytes: 2000, maxMs: 30000, bargeMs: 300 };

export function createListener({ onUtterance, onLevel = () => {}, onState = () => {}, onBargeIn = () => {} }) {
  let cfg = { ...DEFAULTS };
  let stream = null;
  let ctx = null;
  let analyser = null;
  let timer = null;
  let recorder = null;
  let chunks = [];
  let paused = true;
  let speechStart = 0;
  let lastVoice = 0;
  let noise = 0.01;
  let barge = false;
  let bargeSince = 0;

  function configure(settings, persona) {
    const vad = settings?.vad || {};
    cfg = {
      silenceMs: vad.diam_selesai_ms?.[persona] ?? DEFAULTS.silenceMs,
      minSpeechMs: vad.min_bicara_ms ?? DEFAULTS.minSpeechMs,
      minBytes: settings?.rekaman?.min_ukuran_byte ?? DEFAULTS.minBytes,
      maxMs: DEFAULTS.maxMs,
      bargeMs: vad.barge_in_ms ?? DEFAULTS.bargeMs,
    };
  }

  async function start() {
    if (stream) return;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    timer = setInterval(() => tick(buf), 50);
  }

  function tick(buf) {
    if (paused) return;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    onLevel(Math.min(1, rms * 8));
    const now = performance.now();

    if (barge) {
      if (rms > Math.max(0.06, noise * 6)) {
        if (!bargeSince) bargeSince = now;
        if (now - bargeSince >= cfg.bargeMs) {
          barge = false;
          bargeSince = 0;
          onBargeIn();
          lastVoice = now;
          begin(now - cfg.bargeMs);
        }
      } else {
        bargeSince = 0;
      }
      return;
    }

    const threshold = Math.max(0.02, noise * 3);
    const voiced = rms > threshold;
    if (!recorder) noise = noise * 0.95 + Math.min(rms, 0.05) * 0.05;

    if (voiced) {
      lastVoice = now;
      if (!recorder) begin(now);
    } else if (recorder && now - lastVoice > cfg.silenceMs) {
      finish(now);
    }
    if (recorder && now - speechStart > cfg.maxMs) finish(now);
  }

  function begin(now) {
    chunks = [];
    speechStart = now;
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
      .find((t) => window.MediaRecorder?.isTypeSupported?.(t));
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.start();
  }

  function finish(now) {
    const r = recorder;
    recorder = null;
    const spoke = lastVoice - speechStart;
    r.onstop = () => {
      const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
      if (!paused && spoke >= cfg.minSpeechMs && blob.size >= cfg.minBytes) onUtterance(blob);
    };
    r.stop();
    void now;
  }

  function bargeIn(on) {
    if (!stream) return;
    if (on) {
      if (recorder) return;
      barge = true;
      bargeSince = 0;
      paused = false;
      ctx?.resume?.();
    } else if (barge) {
      barge = false;
      paused = true;
    }
  }

  function pause() {
    barge = false;
    paused = true;
    if (recorder) {
      recorder.onstop = null;
      recorder.stop();
      recorder = null;
    }
    onLevel(0);
    onState('idle');
  }

  function resume() {
    if (!stream) return;
    paused = false;
    ctx?.resume?.();
    onState('listening');
  }

  function stop() {
    pause();
    clearInterval(timer);
    stream?.getTracks().forEach((t) => t.stop());
    ctx?.close?.();
    stream = null;
  }

  return {
    start, pause, resume, stop, configure, bargeIn,
    get active() { return Boolean(stream) && !paused && !barge; },
    get recording() { return Boolean(recorder); },
  };
}
