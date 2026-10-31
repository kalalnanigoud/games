// Network settings.
//
// STUN servers let most players connect directly to each other for free.
// Some mobile networks block direct connections; for those a TURN relay is needed.
// Use short-lived credentials from your own authenticated service for production;
// never commit a permanent provider secret. Voice can use substantially more
// bandwidth than game moves. No relay is provisioned by this static app.
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
  // Anonymous crash reports (js/report.js). Empty = off. node tools/deploy-error-reports.mjs deploys
  // server/error-reports.js and fills this in, e.g. 'https://gn-errors.you.workers.dev/report'.
  errorReports: 'https://gn-errors.coopp.workers.dev/report',
  // Creature Island cloud saves (server/island-saves.js). Empty = players can still save to a file.
  // node tools/deploy-island-saves.mjs deploys the Worker and fills this in, e.g. 'https://island-saves.you.workers.dev'.
  islandSaves: 'https://island-saves.coopp.workers.dev',
};
