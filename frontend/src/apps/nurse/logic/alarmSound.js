let ctx;
function beep(freq, duration = 0.25, volume = 0.25) {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch {
  }
}

export function createAlarmSound() {
  let timer = null;
  let lastKey = '';
  return {
    update({ hasRed, hasOrange, escalated, muted }) {
      const key = [hasRed, hasOrange, escalated, muted].join();
      if (key === lastKey) return;
      lastKey = key;
      clearInterval(timer);
      if (muted || (!hasRed && !hasOrange)) return;
      const play = () => {
        const vol = escalated ? 0.6 : 0.35;
        if (hasRed) {
          beep(1000, 0.15, vol);
          setTimeout(() => beep(1000, 0.15, vol), 333);
          setTimeout(() => beep(1000, 0.15, vol), 666);
        } else {
          beep(880, 0.18, vol);
          setTimeout(() => beep(880, 0.18, vol), 260);
        }
      };
      play();
      timer = setInterval(play, hasRed ? 1000 : 1500);
    },
  };
}
