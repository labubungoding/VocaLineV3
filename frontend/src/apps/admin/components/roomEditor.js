import { html } from '../../../lib/dom';

export function roomEditorHtml(room, beds, tabletLabel) {
  return html`
    <div id="sa-room-${room.id}" class="card room-editor">
      <div class="room-editor__head">
        <b class="room-editor__name">Kamar ${room.number}</b>
        <button id="sa-btn-edit-room-${room.id}" type="button" class="btn btn--icon btn--ghost btn--sm" aria-label="Edit kamar" data-action="edit-room" data-id="${room.id}">Edit</button>
        <button id="sa-btn-delete-room-${room.id}" type="button" class="btn btn--icon btn--ghost btn--danger btn--sm" aria-label="Hapus kamar" data-action="delete-room" data-id="${room.id}">Hapus</button>
      </div>
      ${beds.map((b) => html`
        <div id="sa-bed-${b.id}" class="room-editor__bed">
          <span class="room-editor__bed-text">
            <b>Kasur ${b.label}</b><br />
            <span class="muted mono">${tabletLabel(b)}</span>
          </span>
          <button id="sa-btn-delete-bed-${b.id}" type="button" class="btn btn--icon btn--ghost btn--danger" aria-label="Hapus kasur" data-action="delete-bed" data-id="${b.id}">×</button>
        </div>`)}
      <button id="sa-btn-add-bed-${room.id}" type="button" class="btn btn--sm room-editor__add" data-action="add-bed" data-id="${room.id}">+ Kasur</button>
    </div>`;
}
