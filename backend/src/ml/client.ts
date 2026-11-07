import { ApiError } from '../http/errors.ts';
import { log } from '../lib/log.ts';

export interface MlAnswer {
  teks_pasien: string;
  skor_keyakinan: number;
  maksud: string;
  level_alarm: string;
  ringkasan_alarm: string | null;
  emosi: string;
  visual_vine: string;
  balasan_teks: string | null;
  perlu_tanya_ulang: boolean;
  perintah: string | null;
  sumber_balasan: string;
  waktu_proses_ms: number;
  kecepatan_bicara: number;
  balasan_audio: string | null;
  ekspresi: string | null;
}

export interface MlSpeech {
  balasan_teks: string;
  visual_vine: string;
  kecepatan_bicara: number;
  balasan_audio: string | null;
}

export class MlClient {
  private base: string;
  private key: string;
  private timeoutMs: number;
  constructor(base: string, key: string, timeoutMs: number) {
    this.base = base;
    this.key = key;
    this.timeoutMs = timeoutMs;
  }

  private async request(method: string, path: string, body?: unknown, timeoutMs = this.timeoutMs): Promise<Response> {
    const started = Date.now();
    try {
      return await fetch(this.base + path, {
        method,
        headers: { 'X-API-Key': this.key, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      log.warn('ml_tidak_terjangkau', { path, error: (e as Error).name, ms: Date.now() - started });
      throw ApiError.mlUnavailable();
    }
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const started = Date.now();
    const res = await this.request('POST', path, body);
    if (!res.ok) {
      log.warn('ml_error', { path, status: res.status, ms: Date.now() - started });
      await res.body?.cancel().catch(() => undefined);
      if (res.status === 422) throw ApiError.invalid('ml_bad_audio', 'Audio tidak bisa diproses');
      throw ApiError.mlUnavailable();
    }
    try {
      const json = await res.json();
      if (json == null) throw new Error('kosong');
      return json as T;
    } catch {
      throw ApiError.mlUnavailable();
    }
  }

  async health(): Promise<{ status?: string; komponen?: unknown } | null> {
    const res = await fetch(`${this.base}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`ml health ${res.status}`);
    return (await res.json()) as { status?: string; komponen?: unknown };
  }

  async voiceSettings(): Promise<unknown> {
    const res = await this.request('GET', '/pengaturan-suara');
    if (!res.ok) {
      log.warn('ml_pengaturan_suara_gagal', { status: res.status });
      await res.body?.cancel().catch(() => undefined);
      throw ApiError.mlUnavailable();
    }
    const json = await res.json().catch(() => null);
    if (json == null) throw ApiError.mlUnavailable();
    return json;
  }

  processAudio(body: Record<string, unknown>) { return this.post<MlAnswer>('/process-audio', body); }
  processText(body: Record<string, unknown>) { return this.post<MlAnswer>('/process-text', body); }
  greeting(body: Record<string, unknown>) { return this.post<MlSpeech>('/greeting', body); }
  reminder(body: Record<string, unknown>) { return this.post<MlSpeech>('/reminder', body); }
  async resetSession(idKasur: string) { await this.post<unknown>('/reset-session', { id_kasur: idKasur }); }

  async analyzeOnly(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      let res: Response;
      try {
        res = await fetch(`${this.base}/converse-stream`, {
          method: 'POST',
          headers: { 'X-API-Key': this.key, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } catch (e) {
        log.warn('ml_tidak_terjangkau', { path: '/converse-stream', error: (e as Error).name, ms: Date.now() - started });
        throw ApiError.mlUnavailable();
      }
      if (res.status === 422) throw ApiError.invalid('ml_bad_audio', 'Audio tidak bisa diproses');
      if (!res.ok || !res.body) {
        log.warn('ml_error', { path: '/converse-stream', status: res.status });
        throw ApiError.mlUnavailable();
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let event: string | null = null;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, idx).replace(/\r$/, '');
            buf = buf.slice(idx + 1);
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:') && event === 'analisis') {
              return JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
            }
          }
        }
      } catch (e) {
        if (e instanceof ApiError) throw e;
        log.warn('ml_tidak_terjangkau', { path: '/converse-stream', error: (e as Error).name, ms: Date.now() - started });
        throw ApiError.mlUnavailable();
      }
      throw ApiError.mlUnavailable();
    } finally {
      clearTimeout(timer);
      ctrl.abort();
    }
  }
}
