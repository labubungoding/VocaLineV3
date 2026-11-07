import type { App } from '../app.ts';
import { log } from '../lib/log.ts';
import { fireDue } from '../services/schedules.ts';
import { recordMlHealth } from '../routes/routes.ts';

type Job = { name: string; due: (now: Date) => boolean; run: () => Promise<unknown>; running?: boolean };

function localHm(tz: string, d: Date): { h: number; m: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(d);
  return { h: Number(parts.find((p) => p.type === 'hour')!.value), m: Number(parts.find((p) => p.type === 'minute')!.value) };
}

export function startScheduler(app: App): () => void {
  const tz = app.cfg.timezone;
  const jobs: Job[] = [
    { name: 'escalate', due: () => true, run: () => app.db.one('select public.escalate_alarms() as n') },
    { name: 'tablet-offline', due: () => true, run: () => app.db.one('select public.mark_offline_tablets() as n') },
    { name: 'meal-reminders', due: () => true, run: () => fireDue(app) },
    { name: 'ml-health', due: (d) => d.getUTCMinutes() % 5 === 0, run: () => recordMlHealth(app) },
    { name: 'cleanup', due: (d) => { const t = localHm(tz, d); return t.h === 3 && t.m === 15; }, run: () => app.db.one('select public.vocaline_cleanup() as r') },
  ];

  const tick = () => {
    const now = new Date();
    for (const j of jobs) {
      if (j.running || !j.due(now)) continue;
      j.running = true;
      const started = Date.now();
      j.run()
        .then((r) => log.debug('job_selesai', { job: j.name, ms: Date.now() - started, r: JSON.stringify(r ?? null).slice(0, 200) }))
        .catch((e) => log.warn('job_gagal', { job: j.name, error: (e as Error).message.slice(0, 200) }))
        .finally(() => { j.running = false; });
    }
  };

  let interval: NodeJS.Timeout | null = null;
  const first = setTimeout(() => {
    tick();
    interval = setInterval(tick, 60_000);
  }, 60_000 - (Date.now() % 60_000) + 50);
  recordMlHealth(app).catch(() => undefined);
  return () => {
    clearTimeout(first);
    if (interval) clearInterval(interval);
  };
}
