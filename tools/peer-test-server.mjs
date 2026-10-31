// A child process lets the suite tear down all broker timers and sockets.
// Port zero asks the OS for an available port; IPC reports it after listening.
import { PeerServer } from 'peer';

PeerServer({ host: '127.0.0.1', port: 0, alive_timeout: 60000 }, (server) => {
  process.send?.({ port: server.address().port });
});
