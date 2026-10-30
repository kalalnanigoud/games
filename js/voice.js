// Room voice chat. Everyone who joins voice gets a direct audio link to every other member.
// The host keeps the member list ([player id, PeerJS id]) and shares it with every sync;
// each pair connects exactly once: the member with the lower PeerJS id calls the other.

export function createVoice({ toast, onChange }) {
  let stream = null, muted = false, box = null;
  const calls = new Map(); // remote PeerJS id -> MediaConnection
  const pending = new Map();
  let members = new Set();
  let generation = 0;

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
  const drop = (id, call) => {
    if (call && calls.get(id) !== call) return;
    const current = calls.get(id);
    calls.delete(id);
    try { current?.close(); } catch {}
    [...audioBox().children].find((x) => x.dataset.peer === id)?.remove();
    onChange();
  };
  function attach(call) {
    calls.set(call.peer, call);
    call.on('stream', (remote) => {
      if (calls.get(call.peer) !== call || !members.has(call.peer)) return;
      const a = audioFor(call.peer);
      a.srcObject = remote;
      a.play?.().catch(() => {});
      onChange();
    });
    call.on('close', () => drop(call.peer, call));
    call.on('error', () => drop(call.peer, call));
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

  return {
    get active() { return !!stream; },
    get muted() { return muted; },
    get links() { return calls.size; },
    async join() {
      if (stream) return true;
      const attempt = ++generation;
      try {
        const acquired = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (attempt !== generation) { acquired.getTracks().forEach((t) => t.stop()); return false; }
        stream = acquired;
      } catch {
        toast('Microphone unavailable. Allow microphone access in your browser to join voice.');
        return false;
      }
      muted = false;
      onChange();
      return true;
    },
    leave() {
      generation++;
      for (const call of [...pending.keys()]) discard(call);
      members.clear();
      for (const id of [...calls.keys()]) drop(id);
      stream?.getTracks().forEach((t) => t.stop());
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
    // Bring our links in line with the current member list.
    sync(roster, peer) {
      const ids = new Set((roster || []).map(([, id]) => id));
      // The host roster is the authority for both incoming and outgoing calls.
      members = peer && !peer.destroyed && ids.has(peer.id) ? ids : new Set();
      for (const id of [...calls.keys()]) if (!members.has(id)) drop(id);
      for (const call of [...pending.keys()]) if (stream && members.has(call.peer)) {
        clearTimeout(pending.get(call));
        pending.delete(call);
        accept(call);
      }
      if (!stream || !peer || !members.has(peer.id)) return;
      for (const id of members) if (id !== peer.id && !calls.has(id) && peer.id < id) {
        const call = peer.call(id, stream);
        if (call) attach(call);
      }
    },
  };
}
