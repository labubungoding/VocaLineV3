import { html } from '../../../lib/dom';
import { ALARM_LEVELS } from '../../../constants/alarmLevels';
import { formatTimer } from '../../../utils/formatTime';
import { isEscalated } from '../../../utils/sortAlarms';
import { bedShort } from '../../../services/rooms';
import { shortName, userName } from '../../../services/users';

export function alarmCardHtml(alarm, db, now) {
  const level = ALARM_LEVELS[alarm.level] || ALARM_LEVELS.orange;
  const patient = db.patients.find((p) => p.bedId === alarm.bedId);
  const escalated = isEscalated(alarm, db.settings, now);
  const waiting = alarm.status === 'waiting';

  return html`
    <article id="nr-alarm-${alarm.id}" class="alarm-card" data-level="${alarm.level}" data-status="${alarm.status}">
      <div class="alarm-card__head">
        <span class="alarm-card__badge">${level.label}</span>
        <b class="alarm-card__bed">Kamar ${bedShort(db, alarm.bedId)}</b>
        <span class="alarm-card__spacer"></span>
        <span class="alarm-card__timer" data-alarm="${alarm.id}" data-escalated="${String(escalated)}">${formatTimer(now - alarm.createdAt)}</span>
      </div>
      ${patient ? html`<div class="alarm-card__patient"><b>${patient.name}</b> · ${patient.age} th · ${patient.diagnosis}</div>` : ''}
      <p class="alarm-card__summary">"${alarm.summary}"</p>
      ${!waiting ? html`<span class="alarm-card__handler">Ditangani ${shortName(userName(db, alarm.handledBy))}</span>` : ''}
      <div class="alarm-card__actions">
        ${waiting
          ? html`<button id="nr-btn-handle-${alarm.id}" type="button" class="btn btn--primary alarm-card__main" data-action="handle" data-id="${alarm.id}">Saya tangani</button>`
          : html`<button id="nr-btn-resolve-${alarm.id}" type="button" class="btn btn--success alarm-card__main" data-action="resolve" data-id="${alarm.id}">Selesai</button>`}
        <button id="nr-btn-locate-${alarm.id}" type="button" class="btn btn--ghost" data-action="locate" data-id="${alarm.id}">Lihat kasur</button>
      </div>
    </article>`;
}
