import { html } from '../../../lib/dom';

export const AI_STATES = {
  idle: { text: 'Siap mendengar' },
  listening: { text: 'Mendengarkan' },
  thinking: { text: 'Berpikir' },
  speaking: { text: 'AI sedang bicara' },
};

export function aiAvatarHtml({ state = 'idle', emotion = '' } = {}) {
  return html`
    <div id="pt-ai-avatar" class="ai-avatar" data-ai-state="${state}" data-emotion="${emotion || 'neutral'}" aria-hidden="true"></div>`;
}
