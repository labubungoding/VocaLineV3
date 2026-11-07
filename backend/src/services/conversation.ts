import type { App } from '../app.ts';
import { ApiError } from '../http/errors.ts';
import type { TabletIdentity } from '../http/router.ts';
import { log } from '../lib/log.ts';
import { deviceCommand, isOff, isWake, mlEmotion, mlLevel } from '../mapping/mapping.ts';
import { speech } from '../realtime/hub.ts';
import { raise, brief } from './alarms.ts';
import { loadBed, mlFields, type BedContext } from './core.ts';

const OFFER_NURSE = /panggil(kan|in)? perawat\?/i;

function silent(transcript: string, intent: string, command: string | null, ms: number): Record<string, unknown> {
  return {
    transcript, reply: null, emotion: 'neutral', expression: 'netral', retry: { needed: false, attempt: 0 },
    command, offerNurse: false, alarm: null, meta: { intent, replySource: '-', processingMs: ms },
  };
}

async function setAi(app: App, tablet: TabletIdentity, enabled: boolean) {
  await app.db.update('update public.tablets set ai_enabled = :e where id = :id', { e: enabled, id: tablet.id });
}

async function resetMlSession(app: App, ctx: BedContext) {
  try {
    await app.ml.resetSession(ctx.bed.code);
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    log.warn('reset_sesi_ml_gagal', { bed: ctx.bed.code });
  }
}

async function wakeOnly(app: App, tablet: TabletIdentity, ctx: BedContext, body: Record<string, unknown>) {
  const started = Date.now();
  const a = await app.ml.analyzeOnly(body);
  const text = typeof a.teks_pasien === 'string' ? a.teks_pasien : '';
  const wake = a.perintah === 'vine_on' || isWake(text);
  const ms = Date.now() - started;
  if (!wake) return silent('', 'vine_off', null, ms);
  await setAi(app, tablet, true);
  log.info('vine_dinyalakan_suara', { tablet: String(tablet.id) });
  const name = ctx.patient && ctx.patient.nickname && ctx.patient.nickname.trim() !== '' ? `, ${ctx.patient.nickname}` : '';
  const out = silent(text, 'perintah', 'vine_on', ms);
  out.reply = speech(`Halo${name}, saya di sini lagi.`, 'neutral', 1.0, null);
  return out;
}

export async function handleUtterance(app: App, tablet: TabletIdentity, audio: string, retryCount: number) {
  if (tablet.bedId == null) throw ApiError.conflict('not_paired', 'Tablet belum dipasangkan ke kasur');
  const ctx = await loadBed(app.db, tablet.bedId, true);
  if (!ctx.patient) throw ApiError.conflict('not_activated', 'Tablet belum diaktifkan perawat');
  const body = { ...mlFields(ctx), audio, jumlah_tanya_ulang: retryCount };
  if (ctx.tablet && !ctx.tablet.aiEnabled) return wakeOnly(app, tablet, ctx, body);

  const ans = await app.ml.processAudio(body);
  if (ans.maksud === 'tidak_ada_ucapan') return silent('', 'tidak_ada_ucapan', null, ans.waktu_proses_ms ?? 0);

  const level = mlLevel(ans.level_alarm);
  let alarm: Record<string, unknown> | null = null;
  if (level === 'red' || level === 'orange') {
    const summary = ans.ringkasan_alarm == null ? null : ans.ringkasan_alarm.slice(0, 120);
    const source = ans.maksud === 'tidak_jelas' ? 'unclear_speech' : 'ai_voice';
    alarm = brief((await raise(app, ctx, tablet.id, level, source, summary, null)).alarm);
  }

  const command = deviceCommand(ans.perintah);
  if (alarm == null && (command === 'vine_off' || isOff(ans.teks_pasien))) {
    await setAi(app, tablet, false);
    if (command !== 'vine_off') await resetMlSession(app, ctx);
    log.info('vine_dimatikan_suara', { tablet: String(tablet.id) });
    return silent(ans.teks_pasien, 'perintah', 'vine_off', ans.waktu_proses_ms ?? 0);
  }
  if (command === 'vine_on') await setAi(app, tablet, true);

  log.info('ucapan_diproses', { tablet: String(tablet.id), intent: String(ans.maksud), level,
    source: String(ans.sumber_balasan), ms: ans.waktu_proses_ms });

  const emotion = mlEmotion(ans.emosi);
  const offerNurse = alarm == null && (ans.maksud === 'pertanyaan_medis' || (ans.balasan_teks != null && OFFER_NURSE.test(ans.balasan_teks)));
  const retryNeeded = ans.perlu_tanya_ulang === true;
  return {
    transcript: ans.teks_pasien,
    reply: speech(ans.balasan_teks ?? null, emotion, ans.kecepatan_bicara ?? 0, ans.balasan_audio ?? null),
    emotion,
    expression: ans.ekspresi == null ? 'netral' : ans.ekspresi,
    retry: { needed: retryNeeded, attempt: retryNeeded ? retryCount + 1 : 0 },
    command,
    offerNurse,
    alarm,
    meta: { intent: String(ans.maksud), replySource: String(ans.sumber_balasan), processingMs: ans.waktu_proses_ms ?? 0 },
  };
}
