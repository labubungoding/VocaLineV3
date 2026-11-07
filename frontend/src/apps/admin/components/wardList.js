import { html } from '../../../lib/dom';

export function wardListHtml(wards, selectedId) {
  return wards.map((w) => html`
    <li id="sa-ward-${w.id}" class="ward" data-selected="${String(w.id === selectedId)}">
      <button type="button" class="ward__name" data-action="select" data-id="${w.id}">${w.name}</button>
      <button id="sa-btn-edit-ward-${w.id}" type="button" class="btn btn--icon btn--ghost btn--sm" aria-label="Edit bangsal ${w.name}" data-action="edit" data-id="${w.id}">Edit</button>
      <button id="sa-btn-delete-ward-${w.id}" type="button" class="btn btn--icon btn--ghost btn--danger btn--sm" aria-label="Hapus bangsal ${w.name}" data-action="delete" data-id="${w.id}">Hapus</button>
    </li>`);
}
