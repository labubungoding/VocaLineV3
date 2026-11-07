import { callName } from './common';
import { partOfDay } from '../../../utils/formatTime';

const adult = {
  key: 'adult',
  label: 'Dewasa',
  greeting: (name) => `Selamat ${partOfDay()}, ${callName(name)}`,
  caption: 'Bagaimana tidur semalam? Saya di sini kalau mau ngobrol.',
  reminder: (name, type) => `${callName(name)}, sudah waktunya ${type.toLowerCase()}.`,
  ended: (name) => `Semoga lekas sehat, ${callName(name)}`,
};

export default adult;
