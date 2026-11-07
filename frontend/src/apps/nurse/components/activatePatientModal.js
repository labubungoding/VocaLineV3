import { html } from '../../../lib/dom';
import { getDb } from '../../../lib/realtime';
import { isLive } from '../../../lib/supabase';
import { openModal } from '../../../components/ui/modal';
import { ageToPersona, personaLabel } from '../../../utils/ageToPersona';
import { activatePatient, lookupPatient, updatePatient } from '../../../services/patients';
import { bedName } from '../../../services/rooms';
import { toast } from '../../../store/uiStore';

export function openActivatePatientModal({ bedId, patient, onClose }) {
  const db = getDb();
  const ages = db.settings.ages;
  const withLookup = isLive && !patient;
  let hospitalPatientId = null;

  const m = openModal({
    id: 'nr-modal-activate',
    title: patient ? 'Edit data pasien' : 'Aktifkan tablet pasien baru',
    maxWidth: 520,
    onClose,
    body: html`
      <span class="muted activate__bed">${bedName(db, bedId)}</span>
      <form id="nr-form-activate" class="modal__form">
        ${withLookup ? html`
          <div class="activate__lookup">
            <label class="lbl">
              No. RM (opsional)
              <input id="nr-input-patient-rm" class="fi mono" maxlength="40" placeholder="Isi lalu tekan Cari" />
            </label>
            <button id="nr-btn-lookup-patient" type="button" class="btn">Cari</button>
          </div>
          <p id="nr-lookup-result" class="text-xs" hidden></p>` : ''}
        <label class="lbl">
          Nama pasien
          <input id="nr-input-patient-name" class="fi" required maxlength="120" value="${patient?.name || ''}" ${withLookup ? '' : 'autofocus'} />
        </label>
        <div class="activate__row">
          <label class="lbl">
            Umur
            <input id="nr-input-patient-age" class="fi" type="number" min="0" max="130" step="1" required value="${patient ? String(patient.age) : ''}" />
          </label>
          <label class="lbl">
            Penyakit
            <input id="nr-input-patient-diagnosis" class="fi" required maxlength="200" value="${patient?.diagnosis || ''}" />
          </label>
        </div>
        <p id="nr-age-warning" role="alert" class="alert alert--warn" hidden></p>
        <div class="activate__persona">
          <span class="muted">Persona AI otomatis:</span>
          <span id="nr-persona-preview" class="pill activate__persona-pill"></span>
        </div>
        <p id="nr-activate-error" role="alert" class="alert alert--error" hidden></p>
        <div class="modal__actions activate__actions">
          <button id="nr-btn-cancel-activate" type="button" class="btn">Batal</button>
          <button id="nr-btn-activate-tablet" type="submit" class="btn btn--primary">${patient ? 'Simpan' : 'Aktifkan tablet'}</button>
        </div>
      </form>`,
  });

  const $ = (id) => m.root.querySelector(id);
  const name = $('#nr-input-patient-name');
  const age = $('#nr-input-patient-age');
  const diagnosis = $('#nr-input-patient-diagnosis');
  const submit = $('#nr-btn-activate-tablet');
  const error = $('#nr-activate-error');
  let saving = false;

  const check = () => {
    const n = Number(age.value);
    const ageOk = age.value !== '' && Number.isInteger(n) && n >= 0 && n <= 130;
    const persona = ageOk ? ageToPersona(age.value, ages) : undefined;
    const warning = $('#nr-age-warning');
    warning.hidden = age.value === '' || persona !== null && ageOk;
    if (!ageOk && age.value !== '') warning.textContent = 'Umur harus bilangan bulat 0–130.';
    else if (n < ages.teenMin) warning.textContent = `Pasien di bawah ${ages.teenMin} tahun tidak diberi tablet. Anak didampingi orang tua.`;
    else warning.textContent = 'Umur ini tidak masuk rentang persona mana pun. Periksa pengaturan Umur & eskalasi di panel superadmin.';
    $('#nr-persona-preview').textContent = personaLabel(persona, ages);
    const valid = Boolean(name.value.trim() && diagnosis.value.trim() && persona);
    submit.disabled = !valid || saving;
    return valid;
  };
  check();
  m.root.addEventListener('input', (e) => {
    if (e.target.id === 'nr-input-patient-rm') {
      hospitalPatientId = null;
      $('#nr-lookup-result').hidden = true;
    }
    check();
  });
  $('#nr-btn-cancel-activate').addEventListener('click', m.dismiss);

  if (withLookup) {
    const rm = $('#nr-input-patient-rm');
    const result = $('#nr-lookup-result');
    const lookupBtn = $('#nr-btn-lookup-patient');
    const lookup = async () => {
      lookupBtn.disabled = true;
      const { data, error: err } = await lookupPatient(rm.value);
      lookupBtn.disabled = false;
      result.hidden = false;
      if (err) {
        hospitalPatientId = null;
        result.className = 'text-xs alert alert--error';
        result.textContent = err;
        return;
      }
      hospitalPatientId = data.hospitalPatientId;
      name.value = data.fullName || '';
      age.value = data.age ?? '';
      diagnosis.value = data.diagnosis || '';
      result.className = data.alreadyActiveInBed ? 'text-xs alert alert--warn' : 'text-xs alert alert--ok';
      result.textContent = data.alreadyActiveInBed
        ? 'Pasien ini masih aktif di kasur lain. Pulangkan dulu dari kasur itu.'
        : `Data pasien ${data.hospitalPatientId} ditemukan dan diisi otomatis.`;
      check();
    };
    lookupBtn.addEventListener('click', lookup);
    rm.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      lookup();
    });
  }

  $('#nr-form-activate').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!check() || saving) return;
    saving = true;
    submit.disabled = true;
    error.hidden = true;
    const err = patient
      ? await updatePatient(patient.id, { name: name.value.trim(), age: age.value, diagnosis: diagnosis.value.trim() })
      : await activatePatient({ bedId, name: name.value, age: age.value, diagnosis: diagnosis.value, hospitalPatientId });
    saving = false;
    check();
    if (err) {
      error.textContent = err;
      error.hidden = false;
      return;
    }
    toast(patient ? 'Data pasien diperbarui' : `Tablet ${bedName(getDb(), bedId)} diaktifkan`, 'success');
    m.dismiss();
  });
}
