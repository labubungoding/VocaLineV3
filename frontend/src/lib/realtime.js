import { getDb, refresh, subscribe } from './mockDb';
import { API_URL, getToken, isLive, isTabletPage } from './supabase';

export { getDb };

let started = false;

function connectEvents(onEvent) {
  let delay = 1000;
  let stopped = false;
  const run = async () => {
    while (!stopped) {
      const token = getToken();
      if (!token) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      try {
        const res = await fetch(`${API_URL}/events`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          cache: 'no-store',
        });
        if (res.status === 401 || res.status === 403) {
          refresh();
          await new Promise((r) => setTimeout(r, 15000));
          continue;
        }
        if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
        delay = 1000;
        refresh();
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
          let i;
          while ((i = buf.indexOf('\n\n')) !== -1) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
            if (!data) continue;
            try {
              onEvent(JSON.parse(data));
            } catch {
            }
          }
        }
      } catch {
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 15000);
    }
  };
  run();
  return () => { stopped = true; };
}

function startLive() {
  if (started || !isLive) return;
  started = true;
  let timer = null;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 300);
  };

  connectEvents((ev) => {
    if (!ev || ev.type === 'ready') return;
    if (isTabletPage) {
      window.dispatchEvent(new CustomEvent('vocaline:tablet-event', { detail: ev }));
      soon();
    } else if (ev.type === 'db_change' || ev.type === 'alarm_new' || ev.type === 'tablet_test_result') {
      soon();
    }
  });

  const every = window.location.pathname.startsWith('/admin') ? 15000 : 5000;
  setInterval(refresh, every);
  window.addEventListener('online', refresh);
}

export function watchDb(fn) {
  startLive();
  fn(getDb());
  return subscribe(() => fn(getDb()));
}

export function watchOnline(fn) {
  const cb = () => fn(navigator.onLine);
  cb();
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}
