const net = require('node:net');
const { mock } = require('node:test');

// Fail immediately if the default suite tries to open a listener or connection.
// Integration tests use a separate entry point without these guards.
const deny = () => { throw new Error('Network access in default tests; use npm run test:integration for transport checks.'); };
mock.method(net.Server.prototype, 'listen', deny);
mock.method(net.Socket.prototype, 'connect', deny);
