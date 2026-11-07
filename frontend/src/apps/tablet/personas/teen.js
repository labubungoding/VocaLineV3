import { callName } from './common';

const teen = {
  key: 'teen',
  label: 'Remaja',
  greeting: (name) => `Hai, ${callName(name)}!`,
  caption: 'Mau ngobrol soal game favoritmu atau dengerin musik santai?',
  reminder: (name, type) => `Udah jam ${type.toLowerCase()} nih, ${callName(name)}. Makan dulu, yuk!`,
  ended: (name) => `Semoga cepet sehat, ${callName(name)}!`,
};

export default teen;
