import { createBlob } from './blob';
import { BLINK, BLOB, EASE_PER_SECOND, EMOTION_MOTION, FACE_BOX, MOUTH, STATE_MOTION } from './avatarConfig';
import neutralSvg from './faces/face-neutral.svg?raw';
import happySvg from './faces/face-happy.svg?raw';
import angrySvg from './faces/face-angry.svg?raw';
import sadSvg from './faces/face-sad.svg?raw';

const NS = 'http://www.w3.org/2000/svg';
const FACE_SOURCES = { neutral: neutralSvg, happy: happySvg, angry: angrySvg, sad: sadSvg };

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const blobPath = createBlob(BLOB);

let svg = null;
let rig = null;
let body = null;
let aura = null;
let faceLayer = null;
const faces = {};

let externalLevel = 0;
let lastExternalAt = -Infinity;
let level = 0;
let demoLevel = false;

let rafId = 0;
let lastTime = 0;
let clock = 0;
let nextBlinkAt = 0;

const cur = { speed: 0.5, amp: 0.04, scale: 1, breathe: 0.02, spin: 0, bounce: 0, jitter: 0, sink: 0, lookX: 0, lookY: 0, swayX: 2, jitterX: 1 };
let spinAngle = 0;

export function setAvatarLevel(value) {
  externalLevel = Math.max(0, Math.min(1, Number(value) || 0));
  lastExternalAt = performance.now();
}

function buildFace(name, source) {
  let src = source;
  const ids = [...new Set([...src.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))];
  ids.forEach((id) => {
    const nid = `ai-face-${name}--${id}`;
    src = src.split(`id="${id}"`).join(`id="${nid}" data-part="${id}"`)
      .split(`#${id})`).join(`#${nid})`)
      .split(`"#${id}"`).join(`"#${nid}"`);
  });

  const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
  const fileRoot = doc.documentElement;
  const out = document.createElementNS(NS, 'svg');
  const w = parseFloat(fileRoot.getAttribute('width')) || 200;
  const h = parseFloat(fileRoot.getAttribute('height')) || 200;
  const viewBox = fileRoot.getAttribute('viewBox') || `0 0 ${w} ${h}`;
  const [, , vw, vh] = viewBox.split(/[\s,]+/).map(Number);
  out.setAttribute('viewBox', viewBox);

  const isFullFrame = vw > 0 && vh > 0 && Math.abs(vw - vh) / Math.max(vw, vh) < 0.05;
  const box = isFullFrame ? { x: 0, y: 0, width: 200, height: 200 } : FACE_BOX;
  if (!isFullFrame) {
    console.warn(`[avatar] face-${name}.svg berukuran ${vw}x${vh}, bukan frame persegi. `
      + 'Wajah dimasukkan ke FACE_BOX. Sebaiknya export seluruh frame persegi dari Figma.');
  }
  out.setAttribute('x', String(box.x));
  out.setAttribute('y', String(box.y));
  out.setAttribute('width', String(box.width));
  out.setAttribute('height', String(box.height));
  out.setAttribute('overflow', 'visible');
  out.setAttribute('class', `ai-face ai-face--${name}`);
  [...fileRoot.attributes].forEach((a) => {
    if (!['width', 'height', 'viewBox', 'xmlns', 'class', 'x', 'y'].includes(a.name) && !a.name.startsWith('xmlns')) {
      out.setAttribute(a.name, a.value);
    }
  });
  [...fileRoot.childNodes].forEach((n) => out.appendChild(document.importNode(n, true)));
  return out;
}

function el(tag, attrs = {}) {
  const e = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  return e;
}

function buildSvg() {
  svg = el('svg', { viewBox: '0 0 200 200', class: 'ai-avatar__svg', 'aria-hidden': 'true', focusable: 'false' });

  const defs = el('defs');
  const filter = el('filter', { id: 'ai-avatar-blur', x: '-50%', y: '-50%', width: '200%', height: '200%' });
  filter.appendChild(el('feGaussianBlur', { stdDeviation: '6' }));
  defs.appendChild(filter);
  svg.appendChild(defs);

  rig = el('g');
  const auraWrap = el('g', { transform: 'translate(100 100) scale(1.19) translate(-100 -100)' });
  aura = el('path', { class: 'ai-avatar__aura', filter: 'url(#ai-avatar-blur)' });
  auraWrap.appendChild(aura);
  body = el('path', { class: 'ai-avatar__body' });
  faceLayer = el('g');
  Object.entries(FACE_SOURCES).forEach(([name, source]) => {
    faces[name] = buildFace(name, source);
    faceLayer.appendChild(faces[name]);
  });

  rig.append(auraWrap, body, faceLayer);
  svg.appendChild(rig);
}

function targetMotion(state, emotion) {
  const s = STATE_MOTION[state] || STATE_MOTION.idle;
  const e = EMOTION_MOTION[emotion] || {};
  return {
    speed: s.speed * (e.speedMul ?? 1),
    amp: Math.min(BLOB.maxAmp ?? 1, Math.max(0, s.amp + (e.ampAdd ?? 0) + level * s.levelAmp)),
    scale: s.scale * (e.scaleMul ?? 1),
    breathe: s.breathe,
    spin: s.spin,
    bounce: e.bounce ?? 0,
    jitter: e.jitter ?? 0,
    sink: e.sink ?? 0,
    lookX: s.lookX ?? 0,
    lookY: s.lookY ?? 0,
    swayX: e.swayX ?? s.swayX ?? 2,
    jitterX: e.jitterX ?? 1,
  };
}

function fakeLevel(now) {
  const v = Math.sin(now / 170) * Math.sin(now / 610 + 1) + 0.25;
  return Math.max(0, Math.min(1, v));
}

function tick(now) {
  rafId = requestAnimationFrame(tick);
  const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 0;
  lastTime = now;

  const host = document.getElementById('pt-ai-avatar');
  if (!host) return;
  if (svg.parentNode !== host) host.appendChild(svg);

  const state = host.dataset.aiState || 'idle';
  const emotion = FACE_SOURCES[host.dataset.emotion] ? host.dataset.emotion : 'neutral';
  const still = reduceMotion.matches;

  const usesLevel = state === 'listening' || state === 'speaking';
  let targetLevel = 0;
  if (usesLevel) {
    if (now - lastExternalAt < 1000) targetLevel = externalLevel;
    else if (demoLevel) targetLevel = fakeLevel(now);
  }
  level += (targetLevel - level) * Math.min(1, dt * 12);

  const target = targetMotion(state, emotion);
  const k = 1 - Math.exp(-dt * EASE_PER_SECOND);
  Object.keys(cur).forEach((key) => { cur[key] += (target[key] - cur[key]) * k; });

  if (!still) {
    clock += dt * cur.speed;
    spinAngle = (spinAngle + dt * cur.spin) % 360;
  }

  const d = blobPath(clock, cur.amp, spinAngle);
  body.setAttribute('d', d);
  aura.setAttribute('d', d);

  const breath = still ? 0 : Math.sin(clock * 2.2) * cur.breathe;
  const s = cur.scale * (1 + breath);
  const bounce = still ? 0 : -Math.abs(Math.sin(clock * 2.6)) * cur.bounce;
  const jx = still ? 0 : (Math.random() - 0.5) * cur.jitter * cur.jitterX;
  const jy = still ? 0 : (Math.random() - 0.5) * cur.jitter;
  const ty = bounce + cur.sink + jy;
  rig.setAttribute('transform', `translate(${100 + jx} ${100 + ty}) scale(${s}) translate(-100 -100)`);

  const fx = still ? 0 : Math.sin(clock * 0.9) * cur.swayX;
  const fy = still ? 0 : Math.cos(clock * 1.1) * 1.5;
  faceLayer.setAttribute('transform', `translate(${fx + cur.lookX} ${fy + cur.lookY})`);

  Object.entries(faces).forEach(([name, face]) => {
    face.classList.toggle('is-active', name === emotion);
  });

  const talking = state === 'speaking' && !still;
  const talk = talking ? Math.min(1, level * MOUTH.levelGain) : 0;
  const openScale = MOUTH.minOpen + talk * (MOUTH.maxOpen - MOUTH.minOpen);
  const mouth = faces[emotion].querySelector('[data-part="mouth"]');
  const mouthOpen = faces[emotion].querySelector('[data-part="mouth-open"]');
  if (mouthOpen) {
    const showOpen = talking && talk > MOUTH.openAt;
    mouthOpen.style.opacity = showOpen ? '1' : '';
    mouthOpen.style.transform = showOpen ? `scaleY(${openScale})` : '';
    if (mouth) { mouth.style.opacity = showOpen ? '0' : ''; mouth.style.transform = ''; }
  } else if (mouth) {
    mouth.style.transform = talking ? `scaleY(${openScale})` : '';
  }

  if (!still && now >= nextBlinkAt) {
    svg.classList.add('is-blinking');
    setTimeout(() => svg.classList.remove('is-blinking'), BLINK.duration);
    nextBlinkAt = now + BLINK.minGap + Math.random() * (BLINK.maxGap - BLINK.minGap);
  }
}

function start() {
  if (rafId) return;
  lastTime = 0;
  rafId = requestAnimationFrame(tick);
}

function stop() {
  cancelAnimationFrame(rafId);
  rafId = 0;
}

export function startAvatarAnimation(options = {}) {
  demoLevel = Boolean(options.demoLevel);
  if (!svg) buildSvg();
  nextBlinkAt = performance.now() + BLINK.minGap;
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  start();
}
