import { html } from '../../../lib/dom';

export function floorMapHtml(rooms) {
  if (rooms.length === 0) return html`<p class="muted">Belum ada kamar di bangsal ini.</p>`;
  return rooms.map((room) => html`
    <div id="nr-room-${room.id}" class="room" data-level="${room.level}">
      <b class="room__name">Kamar ${room.number}</b>
      <div class="room__beds">
        ${room.beds.map((bed) => html`
          <button id="nr-bed-${bed.id}" type="button" class="bed" data-bed="${bed.id}" data-bed-state="${bed.state}">
            <b>Kasur ${bed.label}</b>
            <span>${bed.sub}</span>
          </button>`)}
      </div>
    </div>`);
}
