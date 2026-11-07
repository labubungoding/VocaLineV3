export const BLOB = { points: 8, radius: 64, seed: 11, lumpiness: 0.04, minStretch: 0.95, maxStretch: 1.05, maxAmp: 0.1 };

export const STATE_MOTION = {
  idle:      { speed: 0.5, amp: 0.04, scale: 1.0,  breathe: 0.02,  spin: 0, levelAmp: 0 },
  listening: { speed: 0.8, amp: 0.06, scale: 1.03, breathe: 0.02,  spin: 0, levelAmp: 0.05 },
  thinking:  { speed: 1.4, amp: 0.04, scale: 0.98, breathe: 0.01,  spin: 0, levelAmp: 0, lookX: 4, lookY: -4 },
  speaking:  { speed: 1.0, amp: 0.06, scale: 1.0,  breathe: 0.015, spin: 0, levelAmp: 0.05, swayX: 0 },
};

export const EMOTION_MOTION = {
  neutral: {},
  happy: { speedMul: 1.2, ampAdd: 0.015, bounce: 5 },
  angry: { speedMul: 1.8, ampAdd: 0.015, jitter: 1.2, jitterX: 0, swayX: 0 },
  sad:   { speedMul: 0.5, ampAdd: -0.02, sink: 5, scaleMul: 0.96, swayX: 0 },
};

export const EASE_PER_SECOND = 3;

export const FACE_BOX = { x: 74, y: 76, width: 52, height: 46 };

export const MOUTH = { minOpen: 0.35, maxOpen: 1.1, levelGain: 1.6, openAt: 0.12 };

export const BLINK = { minGap: 2500, maxGap: 5500, duration: 140 };
