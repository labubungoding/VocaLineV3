import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: 'ssl' | 'starttls' | 'none';
  user: string;
  password: string;
  rejectUnauthorized: boolean;
  heloName: string;
  timeoutMs?: number;
}

export interface MailMessage {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export class SmtpError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

function encodeHeader(s: string): string {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

function b64Lines(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
}

function assertAddress(addr: string) {
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+$/.test(addr)) throw new Error('Alamat email tidak valid');
}

export function buildMime(m: MailMessage, domain: string): string {
  assertAddress(m.from);
  assertAddress(m.to);
  const boundary = `vl_${crypto.randomBytes(12).toString('hex')}`;
  const fromName = m.fromName ? `${encodeHeader(m.fromName.replace(/["\r\n]/g, ''))} ` : '';
  const headers = [
    `From: ${fromName}<${m.from}>`,
    `To: <${m.to}>`,
    `Subject: ${encodeHeader(m.subject.replace(/[\r\n]/g, ' '))}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64Lines(m.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64Lines(m.html),
    `--${boundary}--`,
    '',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${body.join('\r\n')}`;
}

class Session {
  private sock: net.Socket;
  private buf = '';
  private waiting: { resolve: (r: { code: number; lines: string[] }) => void; reject: (e: Error) => void } | null = null;
  private lines: string[] = [];
  private error: Error | null = null;

  constructor(sock: net.Socket) {
    this.sock = sock;
    this.attach(sock);
  }

  private attach(sock: net.Socket) {
    sock.setEncoding('utf8');
    sock.on('data', (d: string) => this.onData(d));
    sock.on('error', (e) => this.onError(e));
    sock.on('close', () => this.onError(new Error('Koneksi SMTP tertutup')));
  }

  private onError(e: Error) {
    this.error ??= e;
    if (this.waiting) { this.waiting.reject(e); this.waiting = null; }
  }

  private onData(d: string) {
    this.buf += d;
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, idx).replace(/\r$/, '');
      this.buf = this.buf.slice(idx + 1);
      this.lines.push(line);
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        const code = Number(line.slice(0, 3));
        const lines = this.lines.map((l) => l.slice(4));
        this.lines = [];
        const w = this.waiting;
        this.waiting = null;
        w?.resolve({ code, lines });
      }
    }
  }

  read(): Promise<{ code: number; lines: string[] }> {
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => { this.waiting = { resolve, reject }; });
  }

  async cmd(line: string, expect: number[], redact = false): Promise<{ code: number; lines: string[] }> {
    const p = this.read();
    this.sock.write(`${line}\r\n`);
    const r = await p;
    if (!expect.includes(r.code)) {
      throw new SmtpError(r.code, `SMTP ${redact ? '(perintah disembunyikan)' : line.split(' ')[0]} ditolak: ${r.code} ${r.lines.join(' ').slice(0, 200)}`);
    }
    return r;
  }

  write(data: string) { this.sock.write(data); }

  upgrade(opts: tls.ConnectionOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sock.removeAllListeners('data');
      this.sock.removeAllListeners('close');
      this.sock.removeAllListeners('error');
      const secured = tls.connect({ ...opts, socket: this.sock }, () => resolve());
      secured.once('error', reject);
      this.sock = secured;
      this.attach(secured);
    });
  }

  close() { this.sock.end(); this.sock.destroy(); }
}

export async function sendMail(cfg: SmtpConfig, msg: MailMessage): Promise<void> {
  const timeout = cfg.timeoutMs ?? 20_000;
  const tlsOpts: tls.ConnectionOptions = { servername: net.isIP(cfg.host) ? undefined : cfg.host, rejectUnauthorized: cfg.rejectUnauthorized, minVersion: 'TLSv1.2' };
  const sock: net.Socket = await new Promise((resolve, reject) => {
    const s = cfg.secure === 'ssl'
      ? tls.connect({ host: cfg.host, port: cfg.port, ...tlsOpts }, () => resolve(s))
      : net.connect({ host: cfg.host, port: cfg.port }, () => resolve(s));
    s.once('error', reject);
    s.setTimeout(timeout, () => { s.destroy(new Error('SMTP timeout')); });
  });
  const session = new Session(sock);
  const timer = setTimeout(() => session.close(), timeout);
  try {
    const greet = await session.read();
    if (greet.code !== 220) throw new SmtpError(greet.code, `Server SMTP menolak koneksi: ${greet.lines.join(' ')}`);
    let ehlo = await session.cmd(`EHLO ${cfg.heloName}`, [250]);
    const has = (cap: string) => ehlo.lines.some((l) => l.toUpperCase().startsWith(cap));
    if (cfg.secure === 'starttls') {
      if (!has('STARTTLS')) throw new Error('Server SMTP tidak menawarkan STARTTLS (kredensial tidak dikirim)');
      await session.cmd('STARTTLS', [220]);
      await session.upgrade({ ...tlsOpts, host: cfg.host });
      ehlo = await session.cmd(`EHLO ${cfg.heloName}`, [250]);
    }
    if (cfg.user) {
      const authLine = ehlo.lines.find((l) => l.toUpperCase().startsWith('AUTH')) || '';
      if (/\bPLAIN\b/i.test(authLine) || !/\bLOGIN\b/i.test(authLine)) {
        const token = Buffer.from(`\0${cfg.user}\0${cfg.password}`, 'utf8').toString('base64');
        await session.cmd(`AUTH PLAIN ${token}`, [235], true);
      } else {
        await session.cmd('AUTH LOGIN', [334]);
        await session.cmd(Buffer.from(cfg.user).toString('base64'), [334], true);
        await session.cmd(Buffer.from(cfg.password).toString('base64'), [235], true);
      }
    }
    await session.cmd(`MAIL FROM:<${msg.from}>`, [250]);
    await session.cmd(`RCPT TO:<${msg.to}>`, [250, 251]);
    await session.cmd('DATA', [354]);
    const domain = msg.from.split('@')[1] || 'vocaline.local';
    const data = buildMime(msg, domain).replace(/^\./gm, '..');
    const done = session.read();
    session.write(`${data}\r\n.\r\n`);
    const r = await done;
    if (r.code !== 250) throw new SmtpError(r.code, `Pesan ditolak server SMTP: ${r.code} ${r.lines.join(' ').slice(0, 200)}`);
    await session.cmd('QUIT', [221]).catch(() => undefined);
  } finally {
    clearTimeout(timer);
    session.close();
  }
}
