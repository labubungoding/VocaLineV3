import { html } from '../../../lib/dom';
import { formatDuration } from '../../../utils/formatTime';

const H = 150;

export function barsHtml(days) {
  const max = Math.max(1, ...days.map((d) => d.red + d.orange));
  return days.map((d) => html`
    <div class="bars__day" title="${d.date.getDate()}/${d.date.getMonth() + 1}: ${d.red} merah, ${d.orange} oranye">
      <div class="bars__orange" style="height:${(d.orange / max) * (H - 10)}px"></div>
      <div class="bars__red" style="height:${(d.red / max) * (H - 10)}px"></div>
    </div>`);
}

export function dayLabelsHtml(days) {
  return days.map((d) => html`<span>${d.date.getDate()}</span>`);
}

export function responseHtml(response) {
  const maxResp = Math.max(1, ...response.map((r) => r.seconds));
  return response.map((r) => html`
    <div class="response__row">
      <span>${r.name}</span>
      <span class="response__bar" style="width:${(r.seconds / maxResp) * 100}%;min-width:${r.seconds ? 4 : 0}px"></span>
      <b>${r.count ? formatDuration(r.seconds) : '—'}</b>
    </div>`);
}
