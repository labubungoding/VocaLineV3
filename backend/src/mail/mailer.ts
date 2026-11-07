import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from '../config.ts';
import { sendMail, type SmtpConfig } from './smtp.ts';
import { log } from '../lib/log.ts';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../templates');

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function render(file: string, vars: Record<string, string>): string {
  const tpl = fs.readFileSync(path.join(DIR, file), 'utf8');
  return tpl.replace(/\{\{\s*\.(\w+)\s*\}\}/g, (_, k: string) => escapeHtml(vars[k] ?? ''));
}

function htmlToText(html: string): string {
  return html
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g, '$2: $1')
    .replace(/<\/(p|h\d)>/g, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function wrap(inner: string): string {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"></head>`
    + `<body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2933">${inner}</body></html>`;
}

export class Mailer {
  private cfg: Config;
  override: ((m: { to: string; subject: string; html: string; text: string }) => Promise<void>) | null = null;
  constructor(cfg: Config) {
    this.cfg = cfg;
  }

  get configured(): boolean {
    return Boolean(this.cfg.smtp.host && this.cfg.smtp.from);
  }

  private smtp(): SmtpConfig {
    const s = this.cfg.smtp;
    return { host: s.host, port: s.port, secure: s.secure, user: s.user, password: s.password,
      rejectUnauthorized: s.rejectUnauthorized, heloName: s.heloName };
  }

  private async send(to: string, subject: string, htmlInner: string) {
    const html = wrap(htmlInner);
    const text = htmlToText(htmlInner);
    if (this.override) return this.override({ to, subject, html, text });
    if (!this.configured) throw new Error('SMTP belum diatur (SMTP_HOST dan MAIL_FROM kosong)');
    const started = Date.now();
    await sendMail(this.smtp(), { from: this.cfg.smtp.from, fromName: this.cfg.smtp.fromName, to, subject, html, text });
    log.info('email_terkirim', { subject, ms: Date.now() - started });
  }

  private validFor(minutes: number): string {
    if (minutes % 60 === 0) return `${minutes / 60} jam`;
    return `${minutes} menit`;
  }

  async sendInvite(to: string, url: string) {
    const html = render('invite.html', { ConfirmationURL: url, ValidFor: this.validFor(this.cfg.inviteTokenHours * 60) });
    await this.send(to, 'Undangan VocaLine: buat kata sandi', html);
  }

  async sendRecovery(to: string, url: string, byAdmin: boolean) {
    const html = render('recovery.html', {
      ConfirmationURL: url,
      ValidFor: this.validFor(this.cfg.resetTokenMinutes),
      Reason: byAdmin ? 'Admin rumah sakit meminta pengaturan ulang kata sandi untuk akun Anda.'
        : 'Ada permintaan pengaturan ulang kata sandi untuk akun Anda.',
    });
    await this.send(to, 'VocaLine: atur ulang kata sandi', html);
  }

  async sendTest(to: string) {
    await this.send(to, 'VocaLine: tes SMTP', '<h2>Tes SMTP berhasil</h2><p>Email ini dikirim dari server VocaLine self-hosted.</p>');
  }
}
