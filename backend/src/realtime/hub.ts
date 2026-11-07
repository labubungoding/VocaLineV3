import type { ServerResponse } from 'node:http';
import { log } from '../lib/log.ts';

export interface StaffClient {
  kind: 'staff';
  res: ServerResponse;
  userId: string;
  sessionId: string;
  role: 'superadmin' | 'nurse';
  wardIds: string[];
}
export interface TabletClient {
  kind: 'tablet';
  res: ServerResponse;
  tabletId: string;
}
export type Client = StaffClient | TabletClient;

export type RtEvent = { type: string; [k: string]: unknown };

export class EventHub {
  private clients = new Set<Client>();
  private timer: NodeJS.Timeout;
  constructor() {
    this.timer = setInterval(() => {
      for (const c of this.clients) this.write(c, ': ping\n\n');
    }, 25_000);
    this.timer.unref();
  }

  get size() { return this.clients.size; }

  add(c: Client) {
    this.clients.add(c);
    c.res.on('close', () => this.clients.delete(c));
  }

  private write(c: Client, chunk: string) {
    try {
      c.res.write(chunk);
    } catch {
      this.clients.delete(c);
    }
  }

  private emit(c: Client, ev: RtEvent) {
    this.write(c, `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
  }

  toTablet(tabletId: string | null | undefined, ev: RtEvent) {
    if (!tabletId) return;
    let n = 0;
    for (const c of this.clients) {
      if (c.kind === 'tablet' && c.tabletId === tabletId) { this.emit(c, ev); n++; }
    }
    log.debug('rt_tablet', { event: ev.type, delivered: n });
  }

  toWard(wardId: string | null | undefined, ev: RtEvent) {
    if (!wardId) return;
    for (const c of this.clients) {
      if (c.kind === 'staff' && c.role === 'nurse' && c.wardIds.includes(wardId)) this.emit(c, ev);
    }
  }

  dbChange(table: string, wards: string[]) {
    const ev: RtEvent = { type: 'db_change', table };
    for (const c of this.clients) {
      if (c.kind !== 'staff') continue;
      if (c.role === 'superadmin' || wards.some((w) => c.wardIds.includes(w))) this.emit(c, ev);
    }
  }

  disconnect(pred: (c: Client) => boolean) {
    for (const c of [...this.clients]) {
      if (!pred(c)) continue;
      this.clients.delete(c);
      try { c.res.end(); } catch { }
    }
  }
  disconnectSession(sessionId: string) { this.disconnect((c) => c.kind === 'staff' && c.sessionId === sessionId); }
  disconnectUser(userId: string) { this.disconnect((c) => c.kind === 'staff' && c.userId === userId); }
  disconnectTablet(tabletId: string) { this.disconnect((c) => c.kind === 'tablet' && c.tabletId === tabletId); }

  close() {
    clearInterval(this.timer);
    this.disconnect(() => true);
  }
}

export function speech(text: string | null, emotion: string, speechRate: number, audio: string | null) {
  return { text, emotion, speechRate, audio };
}

export const Events = {
  paired: (bedId: string, label: string): RtEvent => ({ type: 'paired', bed: { id: bedId, label } }),
  activated: (session: unknown, greeting: unknown): RtEvent => ({ type: 'activated', session, greeting }),
  alarmStatus: (alarmId: string, level: string, status: string, handlerName: string | null): RtEvent =>
    ({ type: 'alarm_status', alarmId, level, status, handlerName }),
  reminder: (sp: Record<string, unknown>, mealType: string): RtEvent => ({ type: 'reminder', reminder: { ...sp, mealType } }),
  test: (testId: string, kind: string): RtEvent => ({ type: 'test', testId, kind }),
  sessionEnded: (): RtEvent => ({ type: 'session_ended' }),
  sessionUpdated: (session: unknown): RtEvent => ({ type: 'session_updated', session }),
  unpaired: (): RtEvent => ({ type: 'unpaired' }),
  alarmNew: (alarmId: string, level: string, bedId: string, roomNumber: string, bedNumber: string): RtEvent =>
    ({ type: 'alarm_new', alarmId, level, bedId, roomNumber, bedNumber }),
  testResult: (testId: string, tabletId: string, status: string, detail: string | null): RtEvent =>
    ({ type: 'tablet_test_result', testId, tabletId, status, detail }),
};
