import { api } from '../../../lib/supabase';

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export async function sendUtterance(blob, retryCount = 0) {
  const audio = await toBase64(blob);
  return api('/tablet/utterance', { method: 'POST', body: { audio, retryCount } });
}
