import { callName } from './common';
import { partOfDay } from '../../../utils/formatTime';

const elder = {
  key: 'elder',
  label: 'Lansia',
  greeting: (name) => `Selamat ${partOfDay()}, ${callName(name)}`,
  caption: 'Sebentar lagi waktunya makan, ya. Saya temani di sini.',
  reminder: (name, type) => `${callName(name)}, sekarang waktunya ${type.toLowerCase()}. Pelan-pelan saja, ya.`,
  ended: (name) => `Semoga lekas sehat, ${callName(name)}`,
};

export default elder;
