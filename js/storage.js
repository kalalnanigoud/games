// Device preferences and room credentials only. Never use this for adventure saves.
// If storage is blocked/full, retain changes only for this page visit.
const store = (kind) => {
  const memory = new Map();
  return {
    getItem(key) {
      if (memory.has(key)) return memory.get(key);
      try { return globalThis[kind]?.getItem(key) ?? null; } catch { return null; }
    },
    setItem(key, value) {
      value = String(value);
      try { globalThis[kind].setItem(key, value); memory.delete(key); } catch { memory.set(key, value); }
    },
    removeItem(key) {
      try { globalThis[kind].removeItem(key); memory.delete(key); } catch { memory.set(key, null); }
    },
  };
};
export const deviceStorage = store('localStorage');
export const tabStorage = store('sessionStorage');
