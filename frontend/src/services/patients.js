import { update, uid, getDb, send, attempt } from '../lib/mockDb';
import { api, isLive } from '../lib/supabase';

const nickname = (name) => name.trim().slice(0, 30);

export async function lookupPatient(hospitalPatientId) {
  const id = hospitalPatientId.trim();
  if (!id) return { error: 'Isi No. RM.' };
  if (id.length > 40) return { error: 'No. RM maksimal 40 karakter.' };
  if (!isLive) return { error: 'Pencarian No. RM butuh backend.' };
  try {
    return { data: await api('/nurse/patients/lookup', { method: 'POST', body: { hospitalPatientId: id } }) };
  } catch (e) {
    return { error: e.message };
  }
}

export async function activatePatient({ bedId, name, age, diagnosis, hospitalPatientId }) {
  if (isLive) {
    return attempt('/nurse/patients', {
      method: 'POST',
      body: {
        bedId, hospitalPatientId: hospitalPatientId?.trim() || undefined,
        nickname: nickname(name), fullName: name.trim(), age: Number(age), diagnosis: diagnosis.trim(),
      },
    });
  }
  update((db) => {
    db.patients = db.patients.filter((p) => p.bedId !== bedId);
    db.patients.push({ id: uid('pt'), bedId, name: name.trim(), age: Number(age), diagnosis: diagnosis.trim(), admittedAt: Date.now() });
  });
  return null;
}

export async function updatePatient(patientId, fields) {
  if (isLive) {
    return attempt(`/nurse/patients/${patientId}`, {
      method: 'PATCH',
      body: {
        nickname: fields.name ? nickname(fields.name) : undefined,
        fullName: fields.name?.trim() || undefined,
        age: fields.age === undefined ? undefined : Number(fields.age),
        diagnosis: fields.diagnosis?.trim() || undefined,
      },
    });
  }
  update((db) => {
    const p = db.patients.find((x) => x.id === patientId);
    if (p) Object.assign(p, { ...fields, age: Number(fields.age ?? p.age) });
  });
  return null;
}

export function dischargePatient(bedId) {
  const patient = getDb().patients.find((p) => p.bedId === bedId);
  if (isLive && patient) send(`/nurse/patients/${patient.id}`, { method: 'DELETE' });
  update((db) => {
    db.patients = db.patients.filter((p) => p.bedId !== bedId);
    db.alarms.forEach((a) => {
      if (a.bedId !== bedId) return;
      a.patientName = null;
      if (a.status === 'waiting' || a.status === 'handling') {
        a.status = 'resolved';
        a.resolvedAt = Date.now();
      }
    });
  });
}
