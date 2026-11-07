let state = { volume: 60 };
const listeners = new Set();

export function getSession() {
  return state;
}

export function setSession(patch) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function resetSession() {
  setSession({ volume: 60 });
}

export function subscribeSession(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
