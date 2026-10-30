// Room voice chat. Everyone who joins voice gets a direct audio link to every other member.
// The host keeps the member list ([player id, PeerJS id]) and shares it with every sync;
// each pair connects exactly once: the member with the lower PeerJS id calls the other.

export function createVoice({ toast, onChange }) {
  let stream = null, muted = false, box = null;
  const calls = new Map(); // remote PeerJS id -> MediaConnection

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
    try { calls.get(id)?.close(); } catch {}
    calls.delete(id);
    [...audioBox().children].find((x) => x.dataset.peer === id)?.remove();
    onChange();
  };
  function attach(call) {
    calls.set(call.peer, call);
    call.on('stream', (remote) => {
      const a = audioFor(call.peer);
      a.srcObject = remote;
      a.play?.().catch(() => {});
      onChange();
    });
    call.on('close', () => drop(call.peer, call));
    call.on('error', () => drop(call.peer, call));
  }

  return {
    get active() { return !!stream; },
    get muted() { return muted; },
    get links() { return calls.size; },
    async join() {
      if (stream) return true;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch {
        toast('Microphone unavailable. Allow microphone access in your browser to join voice.');
        return false;
      }
      muted = false;
      onChange();
      return true;
    },
    leave() {
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
      if (calls.has(call.peer)) drop(call.peer);
      call.answer(stream);
      attach(call);
    },
    // Bring our links in line with the current member list.
    sync(members, peer) {
      if (!stream || !peer || peer.destroyed || !peer.id) return;
      const ids = new Set((members || []).map(([, id]) => id));
      for (const id of [...calls.keys()]) if (!ids.has(id)) drop(id);
      if (!ids.has(peer.id)) return; // the host hasn't registered us yet
      for (const id of ids) if (id !== peer.id && !calls.has(id) && peer.id < id) {
        const call = peer.call(id, stream);
        if (call) attach(call);
      }
    },
  };
}
