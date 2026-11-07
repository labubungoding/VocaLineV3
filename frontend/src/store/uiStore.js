import { showToast } from '../components/ui/toast';

export function toast(text, kind = 'info', ms = 4000) {
  showToast(text, kind, ms);
}
