function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n) => Math.round(n * 10) / 10;

function smoothClosed(p) {
  const n = p.length;
  let d = `M${r1(p[0][0])},${r1(p[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n];
    const p1 = p[i];
    const p2 = p[(i + 1) % n];
    const p3 = p[(i + 2) % n];
    d += `C${r1(p1[0] + (p2[0] - p0[0]) / 6)},${r1(p1[1] + (p2[1] - p0[1]) / 6)} `
      + `${r1(p2[0] - (p3[0] - p1[0]) / 6)},${r1(p2[1] - (p3[1] - p1[1]) / 6)} `
      + `${r1(p2[0])},${r1(p2[1])}`;
  }
  return `${d}Z`;
}

function softClamp(x, min, max) {
  const mid = (min + max) / 2;
  const half = (max - min) / 2;
  return mid + half * Math.tanh((x - mid) / half);
}

export function createBlob({
  points = 7, radius = 60, cx = 100, cy = 100, seed = 1, minStretch = 0.8, maxStretch = 1.15, lumpiness = 0.55,
} = {}) {
  const rnd = seededRandom(seed);
  const waves = Array.from({ length: points }, () => ({
    base: 1 + (rnd() - 0.5) * lumpiness,
    f1: 0.6 + rnd() * 0.8,
    f2: 1.3 + rnd() * 1.2,
    f3: 0.4 + rnd() * 0.6,
    p1: rnd() * Math.PI * 2,
    p2: rnd() * Math.PI * 2,
    p3: rnd() * Math.PI * 2,
  }));

  return function path(t, amp, rotDeg = 0) {
    const rot = (rotDeg * Math.PI) / 180;
    const pts = waves.map((w, i) => {
      const wave = 0.65 * Math.sin(w.f1 * t + w.p1) + 0.35 * Math.sin(w.f2 * t + w.p2);
      const r = radius * softClamp(w.base * (1 + amp * wave), minStretch, maxStretch);
      const a = (i / points) * Math.PI * 2 + rot + 0.08 * Math.sin(w.f3 * t + w.p3);
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    });
    return smoothClosed(pts);
  };
}
