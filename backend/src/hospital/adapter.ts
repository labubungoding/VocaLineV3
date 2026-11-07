import type { Db } from '../db/db.ts';
import { ageFromBirthDate } from '../lib/util.ts';
import { log } from '../lib/log.ts';

export interface HospitalPatient {
  hospitalPatientId: string;
  fullName: string;
  age: number;
  diagnosis: string;
  allergies: string[];
  history: unknown;
}

export interface HospitalAdapter {
  name: string;
  findPatient(id: string): Promise<HospitalPatient | null>;
}

export class MockHospitalAdapter implements HospitalAdapter {
  name = 'mock';
  private db: Db;
  private tz: string;
  constructor(db: Db, tz: string) {
    this.db = db;
    this.tz = tz;
  }
  async findPatient(id: string): Promise<HospitalPatient | null> {
    const r = await this.db.one(`
      select hospital_patient_id, full_name, birth_date, diagnosis, allergies, history
      from public.mock_simrs_patients where hospital_patient_id = :id`, { id });
    if (!r) return null;
    return {
      hospitalPatientId: r.hospitalPatientId,
      fullName: r.fullName,
      age: ageFromBirthDate(String(r.birthDate), this.tz),
      diagnosis: r.diagnosis,
      allergies: Array.isArray(r.allergies) ? r.allergies.map(String) : [],
      history: r.history ?? [],
    };
  }
}

export class HttpHospitalAdapter implements HospitalAdapter {
  name = 'http';
  private base: string;
  private key: string;
  private tz: string;
  constructor(base: string, key: string, tz: string) {
    this.base = base || 'http://localhost';
    this.key = key;
    this.tz = tz;
  }
  async findPatient(id: string): Promise<HospitalPatient | null> {
    const res = await fetch(`${this.base}/pasien/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${this.key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      log.warn('simrs_error', { status: res.status });
      throw new Error('SIMRS tidak bisa dihubungi');
    }
    const r = (await res.json()) as Record<string, any>;
    if (r == null) return null;
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(r.tanggal_lahir))) throw new Error('tanggal_lahir tidak valid');
    return {
      hospitalPatientId: String(r.no_rm ?? ''),
      fullName: String(r.nama ?? ''),
      age: ageFromBirthDate(String(r.tanggal_lahir), this.tz),
      diagnosis: String(r.diagnosa_utama ?? ''),
      allergies: Array.isArray(r.alergi) ? r.alergi.map(String) : [],
      history: 'riwayat' in r ? r.riwayat : [],
    };
  }
}
