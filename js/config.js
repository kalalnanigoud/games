// Network settings.
//
// STUN servers let most players connect directly to each other for free.
// Some mobile networks block direct connections; for those you can add a
// free TURN relay (e.g. Cloudflare Realtime TURN or Metered free plan) below.
// Board games send only a few KB per move, so a free plan is plenty.
//
// Example TURN entry (replace with your own credentials):
//   { urls: 'turn:global.relay.metered.ca:443', username: 'xxx', credential: 'yyy' },

export default {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
  // Prefix for room IDs on the PeerJS broker. Change it if you fork the site
  // so your rooms don't collide with other copies.
  roomPrefix: 'gamenight-v2-',
};
