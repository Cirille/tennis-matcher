import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { connectToClub } from '../src/clubConnection.js';
import { getPlayerCoordinates } from '../src/playerLocation.js';
import { readPlayerSession, savePlayerSession, clearPlayerSession } from '../src/playerSession.js';

class Socket extends EventEmitter {
  connected = false;
  sent = [];
  connectCalls = 0;
  emit(event, ...args) { this.sent.push({ event, args }); }
  receive(event, ...args) { super.emit(event, ...args); }
  connect() { this.connectCalls += 1; }
}

test('an initially disconnected admin authenticates only after connection and again after reconnect', () => {
  const socket = new Socket();
  const auth = { clubId: 'club-a', role: 'ADMIN', token: 'admin-token' };
  let joined = 0;
  const cleanup = connectToClub(socket, auth, { onJoined: () => { joined += 1; } });
  assert.equal(socket.connectCalls, 1);
  assert.equal(socket.sent.length, 0);
  socket.connected = true;
  socket.receive('connect');
  assert.deepEqual(socket.sent[0].args[0], auth);
  socket.sent[0].args[1]({ success: true });
  socket.receive('disconnect');
  socket.receive('connect');
  assert.deepEqual(socket.sent[1].args[0], auth);
  socket.sent[1].args[1]({ success: true });
  assert.equal(joined, 2);
  cleanup();
});

test('player reconnect reads the latest private session credential', () => {
  const socket = new Socket();
  socket.connected = true;
  let token = 'pin-proof';
  const cleanup = connectToClub(socket, () => ({ clubId: 'club-a', role: 'PLAYER', token }));
  assert.equal(socket.sent[0].args[0].token, 'pin-proof');
  token = 'private-session-proof';
  socket.receive('disconnect');
  socket.receive('connect');
  assert.equal(socket.sent[1].args[0].token, 'private-session-proof');
  cleanup();
});

test('cleanup leaves the club room and removes only its own listeners', () => {
  const socket = new Socket();
  socket.connected = true;
  const otherListener = () => {};
  socket.on('connect', otherListener);
  const cleanup = connectToClub(socket, { clubId: 'club-a', role: 'ADMIN', token: 'token' });
  cleanup();
  assert.deepEqual(socket.listeners('connect'), [otherListener]);
  assert.equal(socket.listenerCount('disconnect'), 0);
  assert.equal(socket.listenerCount('connect_error'), 0);
  assert.deepEqual(socket.sent.at(-1), { event: 'leave_club_room', args: [{ clubId: 'club-a' }] });
});

test('late join acknowledgments are ignored after cleanup or disconnect', () => {
  const socket = new Socket();
  socket.connected = true;
  let joined = 0;
  const cleanup = connectToClub(socket, { clubId: 'club-a' }, { onJoined: () => { joined += 1; } });
  const initialAck = socket.sent[0].args[1];
  socket.receive('disconnect');
  initialAck({ success: true });
  socket.receive('connect');
  const reconnectAck = socket.sent[1].args[1];
  cleanup();
  reconnectAck({ success: true });
  assert.equal(joined, 0);
});

test('an authorization rejection reports its error without calling the joined callback', () => {
  const socket = new Socket();
  socket.connected = true;
  const errors = [];
  const cleanup = connectToClub(socket, { clubId: 'club-a' }, {
    onJoined: () => assert.fail('Rejected join must not succeed'),
    onError: error => errors.push(error)
  });
  socket.sent[0].args[1]({ success: false, error: 'Session expired' });
  assert.deepEqual(errors, ['Session expired']);
  cleanup();
});

test('denied, unavailable, or invalid geolocation never fabricates zero coordinates', async () => {
  assert.deepEqual(await getPlayerCoordinates(null), {});
  assert.deepEqual(await getPlayerCoordinates({ getCurrentPosition: (_success, fail) => fail() }), {});
  assert.deepEqual(await getPlayerCoordinates({ getCurrentPosition: () => { throw new Error('Unavailable'); } }), {});
  assert.deepEqual(await getPlayerCoordinates({ getCurrentPosition: success => success({ coords: { latitude: NaN, longitude: 10 } }) }), {});
});

test('real zero coordinates are preserved and location requests have a timeout', async () => {
  let options;
  const location = await getPlayerCoordinates({
    getCurrentPosition(success, _fail, settings) {
      options = settings;
      success({ coords: { latitude: 0, longitude: 0 } });
    }
  });
  assert.deepEqual(location, { lat: 0, lng: 0 });
  assert.equal(options.timeout, 10000);
});

const memoryStorage = () => {
  const data = new Map();
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key)
  };
};

test('player credentials remain separate for each club and clear independently', () => {
  const storage = memoryStorage();
  const first = { sessionId: 'player-a', sessionToken: 'private-a' };
  const second = { joinToken: 'proof-b' };
  savePlayerSession('club-a', first, storage);
  savePlayerSession('club-b', second, storage);
  assert.deepEqual(readPlayerSession('club-a', storage), first);
  assert.deepEqual(readPlayerSession('club-b', storage), second);
  clearPlayerSession('club-a', storage);
  assert.equal(readPlayerSession('club-a', storage), null);
  assert.deepEqual(readPlayerSession('club-b', storage), second);
});

test('corrupt or incomplete stored sessions are ignored', () => {
  const storage = memoryStorage();
  storage.setItem('tennis_session:club-a', '{broken-json');
  assert.equal(readPlayerSession('club-a', storage), null);
  savePlayerSession('club-a', { sessionId: 'public-id-without-secret' }, storage);
  assert.equal(readPlayerSession('club-a', storage), null);
});
