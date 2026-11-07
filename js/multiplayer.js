// Optional networking must never block rendering or solo play.
const urls = ['https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js', 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'];
let pending = null;
const attempt = (url) => new Promise((resolve) => {
  const script = document.createElement('script');
  let timer;
  const done = () => {
    clearTimeout(timer); script.onload = script.onerror = null; script.remove();
    resolve(typeof globalThis.Peer === 'function');
  };
  script.src = url; script.async = true;
  script.onload = script.onerror = done;
  timer = setTimeout(done, 6000);
  document.head.appendChild(script);
});
const load = () => (pending = (async () => {
  try { for (const url of urls) if (await attempt(url)) return true; return false; }
  finally { pending = null; }
})());
// A request that arrives while an earlier load is still running shares it. But that load may have started under
// different conditions (offline a moment ago, or a CDN that has since recovered) and be about to fail, often only
// on its 6 s timeout. So if the shared load fails, the later request gets one fresh try of its own instead of
// inheriting the old failure.
export function loadMultiplayer() {
  if (typeof globalThis.Peer === 'function') return Promise.resolve(true);
  if (!pending) return load();
  return pending.then((ok) => ok || typeof globalThis.Peer === 'function' || (pending || load()));
}
