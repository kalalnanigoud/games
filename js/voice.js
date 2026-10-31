// Room voice chat. Everyone who joins voice gets a direct audio link to every other member.
// The host keeps the member list ([player id, PeerJS id]) and shares it with every sync;
// each pair connects exactly once: the member with the lower PeerJS id calls the other.
//
// Phones drop off in ways that rarely close a call cleanly (switched off, Wi-Fi lost, moving between
// Wi-Fi and mobile data), so every link is watched: a call that never brings audio, or whose link goes
// quiet, is dropped and dialled again (with a growing pause, for someone who is really gone). And when
// the phone stops the microphone (screen lock, a phone call, a headset change) it is reopened.

const AUDIO = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
const CONNECT_MS = 15000; // a call with no audio by then is given up
const STALL_MS = 6000; // a link "disconnected" this long is treated as dead
const HEAL_MS = 5000; // how often missing links are looked for while in voice

export function createVoice({ toast, onChange, onLost }) {
  let stream = null, muted = false, box = null;
  const calls = new Map(); // remote PeerJS id -> MediaConnection
  const pending = new Map();
  const timers = new Map(); // MediaConnection -> { connect, stall }
  const retry = new Map(); // remote PeerJS id -> { at, tries }: when it may be dialled again
  let members = new Set();
  let generation = 0;
  let roster = null, self = null; // the latest member list and our Peer, to redial lost links
  let healTimer = null, soon = null;

  const audioBox = () => {
    if (!box) { box = document.createElement('div'); box.id = 'voiceAudio'; box.hidden = true; document.body.appendChild(box); }
    return box;
  };
  const audioFor = (id) => {
    let a = [...audioBox().children].find((x) => x.dataset.peer === id);
    if (!a) {
      a = document.createElement('audio');
      a.autoplay = true; a.playsInline = true; a.dataset.peer = id;
      audioBox().appendChild(a);
    }
    return a;
  };
  const forget = (call) => {
    const t = timers.get(call);
    if (t) { clearTimeout(t.connect); clearTimeout(t.stall); timers.delete(call); }
  };
  const drop = (id, call) => {
    if (call && calls.get(id) !== call) return;
    const current = calls.get(id);
    calls.delete(id);
    if (current) forget(current);
    try { current?.close(); } catch {}
    [...audioBox().children].find((x) => x.dataset.peer === id)?.remove();
    onChange();
  };
  // A link died without anyone leaving: drop it and dial again after a pause that grows each time.
  function lost(call) {
    if (calls.get(call.peer) !== call) return;
    const r = retry.get(call.peer) || { tries: 0 };
    r.tries++;
    r.at = Date.now() + Math.min(15000, 1000 * 2 ** r.tries);
    retry.set(call.peer, r);
    drop(call.peer, call);
    clearTimeout(soon);
    soon = setTimeout(heal, Math.min(15000, 1000 * 2 ** r.tries) + 50);
  }
  function attach(call) {
    calls.set(call.peer, call);
    const t = { connect: setTimeout(() => lost(call), CONNECT_MS), stall: 0 };
    timers.set(call, t);
    call.on('stream', (remote) => {
      if (calls.get(call.peer) !== call || !members.has(call.peer)) return;
      clearTimeout(t.connect);
      retry.delete(call.peer);
      const a = audioFor(call.peer);
      a.srcObject = remote;
      a.play?.().catch(() => {});
      onChange();
    });
    call.on('iceStateChanged', (state) => {
      if (state === 'connected' || state === 'completed') { clearTimeout(t.stall); t.stall = 0; }
      else if (state === 'disconnected') { if (!t.stall) t.stall = setTimeout(() => lost(call), STALL_MS); }
      else if (state === 'failed' || state === 'closed') lost(call);
    });
    call.on('close', () => lost(call));
    call.on('error', () => lost(call));
  }

  function accept(call) {
    if (calls.has(call.peer)) drop(call.peer);
    call.answer(stream);
    attach(call);
  }
  function discard(call) {
    clearTimeout(pending.get(call));
    pending.delete(call);
    call.close();
  }

  // Bring our links in line with the current member list.
  function sync(list, peer) {
    roster = list; self = peer;
    const ids = new Set((list || []).map(([, id]) => id));
    // The host roster is the authority for both incoming and outgoing calls.
    members = peer && !peer.destroyed && ids.has(peer.id) ? ids : new Set();
    for (const id of [...calls.keys()]) if (!members.has(id)) drop(id);
    for (const id of [...retry.keys()]) if (!members.has(id)) retry.delete(id);
    for (const call of [...pending.keys()]) if (stream && members.has(call.peer)) {
      clearTimeout(pending.get(call));
      pending.delete(call);
      accept(call);
    }
    if (!stream || !peer || peer.disconnected || !members.has(peer.id)) return;
    const now = Date.now();
    for (const id of members) if (id !== peer.id && !calls.has(id) && peer.id < id && !(retry.get(id)?.at > now)) {
      const call = peer.call(id, stream);
      if (call) attach(call);
    }
  }
  const heal = () => { if (stream && self) sync(roster, self); };

  // The phone stopped our microphone: reopen it and send the new one on every link.
  function watchMic() {
    for (const track of stream.getAudioTracks()) track.onended = () => { if (stream?.getAudioTracks().includes(track)) reopenMic(); };
  }
  async function reopenMic() {
    const attempt = generation;
    let fresh;
    try { fresh = await navigator.mediaDevices.getUserMedia(AUDIO); } catch {
      if (attempt !== generation || !stream) return;
      toast('Your microphone stopped. Tap the headset to rejoin voice chat.');
      return onLost?.();
    }
    if (attempt !== generation || !stream) return fresh.getTracks().forEach((t) => t.stop());
    const track = fresh.getAudioTracks()[0];
    track.enabled = !muted;
    for (const call of calls.values()) {
      for (const sender of call.peerConnection?.getSenders() || []) if (!sender.track || sender.track.kind === 'audio') sender.replaceTrack(track).catch(() => {});
    }
    stream.getTracks().forEach((t) => t.stop());
    stream = fresh;
    watchMic();
    onChange();
  }
  // Back from the lock screen or another app: phones may have paused our speakers or stopped the mic.
  function wake() {
    if (!stream) return;
    if (stream.getAudioTracks().some((t) => t.readyState === 'ended')) reopenMic();
    for (const a of box?.children || []) a.play?.().catch(() => {});
    heal();
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function' && typeof addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
    addEventListener('pageshow', wake);
    addEventListener('online', () => setTimeout(heal, 1500));
  }

  return {
    get active() { return !!stream; },
    get muted() { return muted; },
    get links() { return calls.size; },
    async join() {
      if (stream) return true;
      const attempt = ++generation;
      try {
        const acquired = await navigator.mediaDevices.getUserMedia(AUDIO);
        if (attempt !== generation) { acquired.getTracks().forEach((t) => t.stop()); return false; }
        stream = acquired;
      } catch {
        toast('Microphone unavailable. Allow microphone access in your browser to join voice.');
        return false;
      }
      muted = false;
      watchMic();
      clearInterval(healTimer);
      healTimer = setInterval(heal, HEAL_MS);
      onChange();
      return true;
    },
    leave() {
      generation++;
      clearInterval(healTimer); clearTimeout(soon);
      for (const call of [...pending.keys()]) discard(call);
      members.clear();
      retry.clear();
      for (const id of [...calls.keys()]) drop(id);
      stream?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
      stream = null;
      onChange();
    },
    toggleMute() {
      muted = !muted;
      stream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
      onChange();
    },
    // Someone in the room is calling us.
    answer(call) {
      if (!stream) return call.close();
      if (members.has(call.peer)) return accept(call);
      // A legitimate call can beat the host's roster message. Wait briefly,
      // without sharing any audio, and only answer if the host authorizes it.
      if (pending.size >= 8) return call.close();
      pending.set(call, setTimeout(() => discard(call), 2000));
      call.on('close', () => { clearTimeout(pending.get(call)); pending.delete(call); });
    },
    // The broker says a PeerJS id we dialled isn't there (that phone left or lost its connection).
    unreachable(id) {
      const call = calls.get(id);
      if (call) lost(call);
    },
    sync,
  };
}
