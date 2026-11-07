import QRCode from 'qrcode';
import { $, html, setHtml } from '../../lib/dom';
import { getDb, watchDb, watchOnline } from '../../lib/realtime';
import { createAlarm, cancelAlarm, activeAlarmsForBed } from '../../services/alarms';
import { bedName } from '../../services/rooms';
import { schedulesForRoom } from '../../services/schedules';
import { userName } from '../../services/users';
import { ageToPersona } from '../../utils/ageToPersona';
import { hhmm } from '../../utils/formatTime';
import { getDeviceId } from './logic/deviceId';
import { createTabletChannel } from './logic/tabletChannel';
import { getSession, resetSession, setSession, subscribeSession } from './store/sessionStore';
import teen from './personas/teen';
import adult from './personas/adult';
import elder from './personas/elder';

import { setupPageHtml } from './pages/setup';
import { standbyPageHtml } from './pages/standby';
import { conversationPageHtml } from './pages/conversation';
import { emotionPageHtml, EMOTIONS } from './pages/emotion';
import { endedPageHtml } from './pages/ended';
import { aiOffPageHtml } from './pages/aiOff';
import { alarmOverlayHtml } from './components/alarmOverlay';
import { reminderOverlayHtml } from './components/reminderOverlay';
import { testBannerHtml } from './components/testBanner';
import { demoBarHtml, demoSelectHtml } from './components/demoBar';
import { bindEmergencyButtons } from './components/emergencyButton';
import { setAvatarLevel, startAvatarAnimation } from './components/avatar/avatarAnimator';
import { api, isLive } from '../../lib/supabase';
import { refresh } from '../../lib/mockDb';
import { createListener } from './logic/speechToText';
import { speak, stopSpeaking, voiceTone } from './logic/textToSpeech';
import { sendUtterance } from './services/stt';
import { loadVoiceSettings } from './services/tts';

const PERSONAS = { teen, adult, elder };
const SAMPLE_NAMES = { teen: 'Raka', adult: 'Bu Rina', elder: 'Pak Harjo' };
const ENDED_SECONDS = 5;

const SCREENS = [
  ['auto', 'Otomatis (dari data)'],
  ['setup', '03 · Belum terpasang'],
  ['standby', '04 · Menunggu aktivasi'],
  ['conversation', '05 · Percakapan'],
  ['alarm', '06 · Alarm terkirim'],
  ['reminder', '07 · Pengingat makan'],
  ['ended', '08 · Sesi berakhir'],
  ['emotion', '22 · Respons emosi'],
  ['ai-off', '23 · AI nonaktif'],
];

const params = new URLSearchParams(window.location.search);
const channel = createTabletChannel();
const qrCache = {};

const state = {
  showDemo: isLive ? params.get('demo') === '1' : params.get('demo') !== '0',
  demoOpen: true,
  bedId: params.get('bed') || '105b',
  screen: 'auto',
  personaPick: 'auto',
  aiState: isLive ? 'idle' : 'speaking',
  situation: 'normal',
  emotion: 'angry',
  alarmLevel: 'red',
  alarmStatus: 'waiting',
  aiOff: false,
  ended: null,
  endedLeft: ENDED_SECONDS,
  dismissed: {},
  online: navigator.onLine,
  clock: hhmm(),
  lastPatient: undefined,
  caption: '',
  said: '',
  replyEmotion: 'neutral',
  retryCount: 0,
  rate: 1,
  lastReply: null,
};

let view = 'auto';
let current = {};

function set(patch) {
  Object.assign(state, patch);
  render();
}

function qrFor(deviceId) {
  if (qrCache[deviceId] === undefined) {
    qrCache[deviceId] = '';
    QRCode.toString(deviceId, { type: 'svg', margin: 0, width: 156, color: { dark: '#132a2c', light: '#ffffff' } })
      .then((svg) => {
        qrCache[deviceId] = svg;
        render();
      })
      .catch(() => {});
  }
  return qrCache[deviceId];
}

function render() {
  const db = getDb();
  const { volume } = getSession();
  const bedId = isLive ? db.me?.bedId : state.bedId;
  const bed = db.beds.find((b) => b.id === bedId);
  const tablet = bed && db.tablets.find((t) => t.id === bed.tabletId);
  const patient = bed && db.patients.find((p) => p.bedId === bed.id);
  const deviceId = tablet?.deviceId || db.me?.deviceId || getDeviceId();
  const test = channel.update(deviceId, db);

  const personaKey = state.personaPick !== 'auto' ? state.personaPick : ageToPersona(patient?.age, db.settings.ages) || 'adult';
  const persona = PERSONAS[personaKey];
  const name = patient?.name || SAMPLE_NAMES[personaKey];
  const label = bed ? bedName(db, bed.id) : '—';

  const left = state.lastPatient;
  state.lastPatient = patient;
  if (left && !patient && left.bedId === bedId) {
    state.ended = persona.ended(left.name);
    state.endedLeft = ENDED_SECONDS;
    state.aiOff = false;
    setTimeout(resetSession, 0);
  }

  const today = new Date().toDateString();
  const dueReminder = bed && patient
    ? schedulesForRoom(db, bed.roomId).find((s) => s.active && s.time === state.clock && !state.dismissed[`${s.id}-${today}`])
    : null;
  const alarm = bed ? activeAlarmsForBed(db, bed.id)[0] : null;

  if (isLive && db.me && state.aiSynced !== (db.me.tabletId || null)) {
    state.aiOff = db.me.aiEnabled === false;
    state.aiSynced = db.me.tabletId || null;
  }

  let next = state.screen;
  if (next === 'auto') {
    if (state.ended) next = 'ended';
    else if (!tablet || tablet.disabled) next = 'setup';
    else if (!patient) next = 'standby';
    else if (state.aiOff) next = 'ai-off';
    else next = 'conversation';
  }
  if (next === 'ended' && view !== 'ended') state.endedLeft = ENDED_SECONDS;
  view = next;

  let page;
  if (view === 'setup') page = setupPageHtml({ deviceId, disabled: tablet?.disabled, online: state.online, qrSvg: qrFor(deviceId) });
  else if (view === 'standby') page = standbyPageHtml({ bedLabel: label });
  else if (view === 'ended') page = endedPageHtml({ message: state.ended || persona.ended(name), left: state.endedLeft, seconds: ENDED_SECONDS });
  else if (view === 'ai-off') page = aiOffPageHtml({ bedLabel: label, bedId: bed?.id });
  else if (view === 'emotion') page = emotionPageHtml({ emotion: state.emotion, greeting: persona.greeting(name), bedId: bed?.id, volume });
  else if (isLive && view === 'conversation' && state.replyEmotion !== 'neutral' && state.situation === 'normal') {
    page = emotionPageHtml({
      emotion: state.replyEmotion, greeting: persona.greeting(name), said: state.said, reply: state.caption,
      bedId: bed?.id, volume, aiState: state.aiState,
    });
  } else {
    page = conversationPageHtml({
      greeting: persona.greeting(name),
      caption: isLive && state.caption ? state.caption : persona.caption,
      aiState: state.aiState,
      situation: state.situation,
      offline: !state.online,
      bedId: bed?.id,
      volume,
      emotion: isLive ? state.replyEmotion : 'neutral',
    });
  }

  let overlay = '';
  current = { bed, alarm: null, dueReminder: null, today };
  if (view === 'alarm') {
    overlay = alarmOverlayHtml({ level: state.alarmLevel, status: state.alarmStatus, nurseName: 'Sari', bedId: bed?.id, canCancel: true });
  } else if (state.screen === 'auto' && patient && alarm && !state.ended) {
    current.alarm = alarm;
    overlay = alarmOverlayHtml({
      level: alarm.level,
      status: alarm.status,
      nurseName: alarm.handledBy ? userName(db, alarm.handledBy).split(' ')[0] : '',
      bedId: bed.id,
      canCancel: true,
    });
  } else if (view === 'reminder') {
    overlay = reminderOverlayHtml({ time: '12.00', text: persona.reminder(name, 'Makan siang'), bedId: bed?.id });
  } else if (state.screen === 'auto' && dueReminder && !state.ended) {
    current.dueReminder = dueReminder;
    overlay = reminderOverlayHtml({ time: dueReminder.time.replace(':', '.'), text: persona.reminder(name, dueReminder.type), bedId: bed.id });
  }

  $('#pt-root').className = `tablet persona-${personaKey}`;
  setHtml($('#pt-page'), page);
  setHtml($('#pt-overlay'), overlay);
  setHtml($('#pt-banner'), test && (view === 'standby' || view === 'conversation') ? testBannerHtml(test.type) : '');
  setHtml($('#pt-demo'), state.showDemo ? demoHtml(db, view) : '');

  if (isLive) syncVoice({ listen: (view === 'conversation' || view === 'ai-off') && !overlay && Boolean(patient), personaKey });
}

function demoHtml(db, v) {
  const extra = html`
    ${demoSelectHtml('Persona', 'personaPick', state.personaPick, [['auto', 'Dari umur'], ['teen', 'Remaja'], ['adult', 'Dewasa'], ['elder', 'Lansia']])}
    ${v === 'conversation' ? html`
      ${demoSelectHtml('AI', 'aiState', state.aiState, [['idle', 'Diam'], ['listening', 'Mendengar'], ['thinking', 'Berpikir'], ['speaking', 'Bicara']])}
      ${demoSelectHtml('Situasi', 'situation', state.situation, [['normal', 'Normal'], ['tanya-ulang', 'Tanya ulang'], ['tawarkan-perawat', 'Tawarkan perawat']])}` : ''}
    ${v === 'emotion' ? demoSelectHtml('Emosi', 'emotion', state.emotion, Object.keys(EMOTIONS).map((k) => [k, EMOTIONS[k][0]])) : ''}
    ${v === 'alarm' ? html`
      ${demoSelectHtml('Level', 'alarmLevel', state.alarmLevel, [['red', 'Merah'], ['orange', 'Oranye']])}
      ${demoSelectHtml('Status', 'alarmStatus', state.alarmStatus, [['waiting', 'Menunggu'], ['handling', 'Ditangani']])}` : ''}`;
  return demoBarHtml({
    open: state.demoOpen,
    beds: db.beds.map((b) => ({ id: b.id, label: bedName(db, b.id) })),
    bedId: state.bedId,
    screen: state.screen,
    screens: SCREENS,
    extra,
  });
}

const ACTIONS = {
  'ai-off': () => {
    if (isLive) api('/tablet/ai', { method: 'POST', body: { enabled: false } }).catch(() => {});
    stopSpeaking();
    set({ aiOff: true, screen: 'auto' });
  },
  'ai-on': () => {
    if (isLive) api('/tablet/ai', { method: 'POST', body: { enabled: true } }).catch(() => {});
    set({ aiOff: false, screen: 'auto' });
  },
  'call-nurse': () => {
    if (current.bed) createAlarm({ bedId: current.bed.id, level: 'orange', summary: 'Pasien minta dipanggilkan perawat' });
    set({ situation: 'normal' });
  },
  'decline-nurse': () => set({ situation: 'normal' }),
  'cancel-alarm': () => {
    if (current.alarm) cancelAlarm(current.alarm.id);
    else set({ screen: 'auto' });
  },
  'reminder-ok': () => {
    if (current.dueReminder) set({ dismissed: { ...state.dismissed, [`${current.dueReminder.id}-${current.today}`]: true } });
    else set({ screen: 'auto' });
  },
  'volume-down': () => setSession({ volume: Math.max(0, getSession().volume - 20) }),
  'volume-up': () => setSession({ volume: Math.min(100, getSession().volume + 20) }),
  'demo-toggle': () => set({ demoOpen: !state.demoOpen }),
};

const root = $('#pt-root');
root.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]');
  if (b && ACTIONS[b.dataset.action]) ACTIONS[b.dataset.action]();
  if (isLive && e.target.closest('#pt-btn-repeat') && state.lastReply) repeatLast();
  if (isLive && e.target.closest('#pt-btn-stop-speaking')) stopSpeaking();
});

root.addEventListener('change', (e) => {
  const key = e.target.dataset.demo;
  if (!key) return;
  const patch = { [key]: e.target.value };
  if (key === 'bedId') Object.assign(patch, { ended: null, aiOff: false, lastPatient: undefined });
  set(patch);
});

bindEmergencyButtons(root);

let mic = null;
let voiceSettings = null;
let busy = false;

let voicePersona = null;

function say(reply, expression = 'netral', { remember = true } = {}) {
  if (!reply?.text && !reply?.audio) return Promise.resolve();
  if (state.aiOff) return Promise.resolve();
  if (remember) state.lastReply = { reply, expression };
  set({ aiState: 'speaking', caption: reply.text || state.caption });
  mic?.bargeIn(true);
  const tone = voiceTone(voiceSettings, {
    expression, persona: voicePersona, baseRate: reply.speechRate || 1, extraRate: state.rate,
  });
  return speak({
    text: reply.text,
    rate: tone.rate,
    pitch: tone.pitch,
    audio: reply.audio,
    volume: getSession().volume / 100,
    onLevel: setAvatarLevel,
  }).then(() => {
    mic?.bargeIn(false);
    if (state.aiState === 'speaking') set({ aiState: 'idle' });
  });
}

function repeatLast() {
  if (!state.lastReply) return Promise.resolve();
  return say(state.lastReply.reply, state.lastReply.expression, { remember: false });
}

function onBargeIn() {
  stopSpeaking();
  set({ aiState: 'listening' });
}

function applyCommand(command) {
  const { volume } = getSession();
  if (command === 'vine_off') {
    stopSpeaking();
    set({ aiOff: true, situation: 'normal', screen: 'auto' });
  }
  if (command === 'vine_on') set({ aiOff: false, screen: 'auto' });
  if (command === 'volume_turun') setSession({ volume: Math.max(0, volume - 20) });
  if (command === 'volume_naik') setSession({ volume: Math.min(100, volume + 20) });
  if (command === 'bicara_pelan') state.rate = Math.max(0.6, state.rate - 0.15);
  if (command === 'diam') stopSpeaking();
}

async function onUtterance(blob) {
  if (busy) return;
  busy = true;
  mic?.pause();
  if (!state.aiOff) set({ aiState: 'thinking' });
  let res = null;
  try {
    res = await sendUtterance(blob, state.retryCount);
    if (res.alarm) refresh();
    applyCommand(res.command);
    const nothing = res.meta?.intent === 'tidak_ada_ucapan' || (!res.transcript && !res.reply && !res.command);
    if (!state.aiOff && !nothing) {
      const situation = res.offerNurse ? 'tawarkan-perawat' : res.retry?.needed ? 'tanya-ulang' : 'normal';
      set({
        said: res.transcript || '', replyEmotion: res.emotion || 'neutral', situation,
        retryCount: res.retry?.needed ? res.retry.attempt : 0, caption: res.reply?.text || state.caption,
      });
    }
  } catch (e) {
    if (!state.aiOff) set({ caption: 'Vine sedang istirahat sebentar. Tombol darurat tetap aktif.', replyEmotion: 'neutral' });
  } finally {
    busy = false;
    set({ aiState: 'idle' });
  }
  if (state.aiOff || res?.command === 'diam' || res?.command === 'vine_off') return;
  if (res?.command === 'ulangi' && state.lastReply) await repeatLast();
  else if (res?.reply) await say(res.reply, res.expression || 'netral');
}

let starting = false;
function syncVoice({ listen, personaKey }) {
  const persona = { teen: 'remaja', adult: 'dewasa', elder: 'lansia' }[personaKey];
  voicePersona = persona || null;
  if (!mic && listen && !starting) {
    starting = true;
    mic = createListener({ onUtterance, onBargeIn, onLevel: setAvatarLevel, onState: () => {} });
    Promise.all([mic.start(), loadVoiceSettings()])
      .then(([, settings]) => {
        voiceSettings = settings;
        mic.configure(voiceSettings, persona);
        render();
      })
      .catch(() => {
        mic = null;
        set({ caption: 'Mikrofon belum diizinkan. Ketuk layar lalu izinkan mikrofon.' });
      })
      .finally(() => {
        starting = false;
      });
    return;
  }
  if (!mic || starting) return;
  mic.configure(voiceSettings, persona);
  if (state.aiState === 'speaking') return;
  const canListen = listen && !busy && state.aiState !== 'thinking';
  if (canListen && !mic.active && !mic.recording) {
    mic.resume();
    if (!state.aiOff && state.aiState !== 'listening') setTimeout(() => set({ aiState: 'listening' }), 0);
  } else if (!canListen && mic.active) {
    mic.pause();
  }
}

window.addEventListener('vocaline:tablet-event', (e) => {
  const ev = e.detail || {};
  if (ev.type === 'activated' && ev.greeting) say(ev.greeting);
  if (ev.type === 'reminder' && ev.reminder) say(ev.reminder);
  if (ev.type === 'session_ended' || ev.type === 'unpaired') stopSpeaking();
});

watchDb(render);
subscribeSession(render);
startAvatarAnimation({ demoLevel: state.showDemo });
watchOnline((online) => set({ online }));
setInterval(() => {
  if (hhmm() !== state.clock) set({ clock: hhmm() });
}, 15 * 1000);

setInterval(() => {
  if (view !== 'ended') return;
  if (state.endedLeft > 1) return set({ endedLeft: state.endedLeft - 1 });
  set({ ended: null, screen: 'auto', endedLeft: ENDED_SECONDS });
}, 1000);
