const { test } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const jwt = require('jsonwebtoken');
const { io } = require('socket.io-client');
const { createTennisServer } = require('../../app');

const { MemorySocketServer, request: memoryRequest } = require('./memory-transport');

function defineSessionTests({ network = false } = {}) {
  const secret = 'regression-test-secret-used-only-in-memory';
  const profile = { name: 'Alice', level: 5, gender: 'F' };
  const nearClub = { lat: 52.1, lng: 4.3 };
  const silentLogger = { info() {}, warn() {}, error() {} };
  const query = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });

  function waitFor(socket, event, predicate = () => true) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off(event, listener);
        reject(new Error(`Timed out waiting for ${event}`));
      }, 3000);
      const listener = (data) => {
        if (!predicate(data)) return;
        clearTimeout(timer);
        socket.off(event, listener);
        resolve(data);
      };
      socket.on(event, listener);
    });
  }

  function emitAck(socket, event, data) {
    return new Promise((resolve, reject) => {
      socket.timeout(3000).emit(event, data, (err, result) => err ? reject(err) : resolve(result));
    });
  }

  async function fixture(t) {
    const db = new sqlite3.Database(':memory:');
    const sockets = [];
    let application;
    t.after(async () => {
      sockets.forEach(socket => socket.disconnect());
      if (application) await application.close();
      await new Promise((resolve, reject) => db.close(err => err ? reject(err) : resolve()));
    });
    await new Promise((resolve, reject) => db.exec(`
      CREATE TABLE Clubs (id TEXT PRIMARY KEY, name TEXT, pin TEXT, mapUrl TEXT, lat REAL, lng REAL);
      CREATE TABLE Admins (id INTEGER PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, role TEXT, clubId TEXT);
      INSERT INTO Clubs VALUES ('club-a', 'Club A', '1234', 'https://www.google.com/maps/@52.1,4.3,15z', 52.1, 4.3);
      INSERT INTO Clubs VALUES ('club-b', 'Club B', '5678', NULL, NULL, NULL);
      INSERT INTO Clubs VALUES ('equator', 'Equator', '0000', 'https://www.google.com/maps/@0,0,15z', 0, 0);
    `, err => err ? reject(err) : resolve()));
    const memory = network ? null : new MemorySocketServer();
    application = createTennisServer({
      db, jwtSecret: secret, logger: silentLogger,
      ...(memory ? { createSocketServer: () => memory } : {})
    });
    let url;
    if (network) {
      await new Promise((resolve, reject) => {
        application.server.once('error', reject);
        application.server.listen(0, '127.0.0.1', resolve);
      });
      url = 'http://127.0.0.1:' + application.server.address().port;
    }
    const request = async (path, options = {}) => {
      if (memory) return memoryRequest(application.app, path, options);
      const response = await fetch(url + path, {
        method: options.method || 'GET',
        ...(options.body === undefined ? {} : {
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body)
        })
      });
      return { status: response.status, ...await response.json() };
    };
    return {
      db, request,
      async socket() {
        const socket = memory ? memory.client() : io(url, {
          transports: ['websocket'], reconnection: false, autoConnect: false
        });
        sockets.push(socket);
        socket.on('state_update', state => { socket.lastState = state; });
        const connected = waitFor(socket, 'connect');
        socket.connect();
        await connected;
        return socket;
      },
      pin(clubId = 'club-a', pin = '1234') {
        return request('/api/clubs/' + clubId + '/verify-pin', { method: 'POST', body: { pin } });
      }
    };
  }

  const adminAuth = (clubId = 'club-a', role = 'ADMIN') => ({
    clubId, role: 'ADMIN', token: jwt.sign({ role, clubId }, secret, { expiresIn: '1h' })
  });
  async function joinPlayerRoom(f, socket, clubId = 'club-a', pin = '1234') {
    const credentials = await f.pin(clubId, pin);
    assert.equal(credentials.status, 200);
    assert.equal((await emitAck(socket, 'join_club_room', { clubId, role: 'PLAYER', token: credentials.joinToken })).success, true);
    return credentials;
  }
  async function joinPlayer(socket, details = { ...profile, ...nearClub }) {
    const joined = waitFor(socket, 'player_joined');
    socket.emit('join_player', details);
    return joined;
  }

  test('PIN verification issues a club-bound credential and rejects a wrong PIN', async t => {
    const f = await fixture(t);
    const result = await f.pin();
    assert.equal(result.status, 200);
    const decoded = jwt.verify(result.joinToken, secret);
    assert.equal(decoded.role, 'PLAYER_JOIN');
    assert.equal(decoded.clubId, 'club-a');
    assert.equal((await f.pin('club-a', 'wrong')).status, 401);
    assert.equal((await f.pin('missing', '1234')).status, 404);
    assert.equal((await f.pin('club-a', { invalid: true })).status, 400);
  });

  test('a socket cannot receive club state or join a player without PIN proof', async t => {
    const f = await fixture(t);
    const socket = await f.socket();
    const result = await emitAck(socket, 'join_club_room', { clubId: 'club-a', role: 'PLAYER' });
    assert.equal(result.success, false);
    assert.equal(socket.lastState, undefined);
    const error = waitFor(socket, 'error');
    socket.emit('join_player', { ...profile, ...nearClub });
    assert.match(await error, /Must join a Club Room/);
  });

  test('expired, forged, and cross-club PIN credentials are rejected', async t => {
    const f = await fixture(t);
    const socket = await f.socket();
    const { joinToken } = await f.pin();
    const tokens = [
      joinToken,
      jwt.sign({ role: 'PLAYER_JOIN', clubId: 'club-b' }, secret, { expiresIn: -1 }),
      jwt.sign({ role: 'PLAYER_JOIN', clubId: 'club-b' }, 'wrong-secret')
    ];
    for (const token of tokens) {
      assert.equal((await emitAck(socket, 'join_club_room', { clubId: 'club-b', role: 'PLAYER', token })).success, false);
    }
    assert.equal(socket.lastState, undefined);
  });

  test('a player or root credential cannot claim club admin privileges', async t => {
    const f = await fixture(t);
    const socket = await f.socket();
    for (const role of ['PLAYER_JOIN', 'ROOT']) {
      assert.equal((await emitAck(socket, 'join_club_room', adminAuth('club-a', role))).success, false);
    }
  });

  test('club configuration is loaded before the first player can join', async t => {
    const f = await fixture(t);
    const socket = await f.socket();
    await joinPlayerRoom(f, socket);
    assert.equal(socket.lastState.clubLat, nearClub.lat);
    const failed = waitFor(socket, 'gps_failed');
    socket.emit('join_player', { ...profile, lat: 0, lng: 0 });
    assert.ok((await failed).distance > 2);
    assert.deepEqual(socket.lastState.players, {});
  });

  test('missing and invalid GPS data requires approval instead of admitting a player', async t => {
    const f = await fixture(t);
    const socket = await f.socket();
    await joinPlayerRoom(f, socket);
    for (const coordinates of [{}, { lat: null, lng: null }, { lat: '52.1', lng: 4.3 }, { lat: 91, lng: 4.3 }, { lat: 52.1, lng: 181 }]) {
      const required = waitFor(socket, 'approval_required');
      socket.emit('join_player', { ...profile, ...coordinates });
      assert.match((await required).message, /Location could not be verified/);
      assert.deepEqual(socket.lastState.players, {});
    }
  });

  test('zero latitude and longitude are valid coordinates and still enforce distance', async t => {
    const f = await fixture(t);
    const socket = await f.socket();
    await joinPlayerRoom(f, socket, 'equator', '0000');
    const failed = waitFor(socket, 'gps_failed');
    socket.emit('join_player', { ...profile, lat: 0, lng: 1 });
    assert.ok((await failed).distance > 2);
    const player = await joinPlayer(socket, { ...profile, lat: 0, lng: 0 });
    assert.equal(player.name, profile.name);
  });

  test('a club without configured GPS accepts a PIN-authenticated player without coordinates', async t => {
    const f = await fixture(t);
    const socket = await f.socket();
    await joinPlayerRoom(f, socket, 'club-b', '5678');
    assert.equal((await joinPlayer(socket, profile)).name, profile.name);
  });

  test('private session credentials are delivered only to the joining player', async t => {
    const f = await fixture(t);
    const admin = await f.socket();
    await emitAck(admin, 'join_club_room', adminAuth());
    const playerSocket = await f.socket();
    await joinPlayerRoom(f, playerSocket);
    const state = waitFor(admin, 'state_update', state => Object.keys(state.players).length === 1);
    const player = await joinPlayer(playerSocket);
    assert.equal(jwt.verify(player.sessionToken, secret).sub, player.id);
    assert.equal(JSON.stringify(await state).includes('sessionToken'), false);
  });

  test('knowing a broadcast player ID is insufficient to impersonate their session', async t => {
    const f = await fixture(t);
    const original = await f.socket();
    await joinPlayerRoom(f, original);
    const player = await joinPlayer(original);
    const impostor = await f.socket();
    await joinPlayerRoom(f, impostor);
    const rejected = waitFor(impostor, 'error');
    impostor.emit('join_player', { sessionId: player.id });
    assert.match(await rejected, /Session expired/);
  });

  test('a private session credential restores the same player after reconnect', async t => {
    const f = await fixture(t);
    const original = await f.socket();
    await joinPlayerRoom(f, original);
    const player = await joinPlayer(original);
    original.disconnect();
    const restored = await f.socket();
    assert.equal((await emitAck(restored, 'join_club_room', { clubId: 'club-a', role: 'PLAYER', token: player.sessionToken })).success, true);
    const samePlayer = await joinPlayer(restored, { sessionId: player.id });
    assert.equal(samePlayer.id, player.id);
    assert.equal(samePlayer.disconnected, false);
    assert.equal(samePlayer.currentSocketId, restored.id);
  });

  test('a removed session cannot be restored using its previously valid credential', async t => {
    const f = await fixture(t);
    const admin = await f.socket();
    await emitAck(admin, 'join_club_room', adminAuth());
    const original = await f.socket();
    await joinPlayerRoom(f, original);
    const player = await joinPlayer(original);
    const removed = waitFor(original, 'player_removed');
    admin.emit('admin_remove_player', { playerId: player.id });
    await removed;
    const restored = await f.socket();
    const result = await emitAck(restored, 'join_club_room', { clubId: 'club-a', role: 'PLAYER', token: player.sessionToken });
    assert.equal(result.success, false);
    assert.match(result.error, /Session expired/);
  });

  test('GPS failure can proceed through admin approval and yields a reconnect credential', async t => {
    const f = await fixture(t);
    const admin = await f.socket();
    await emitAck(admin, 'join_club_room', adminAuth());
    const socket = await f.socket();
    await joinPlayerRoom(f, socket);
    const pending = waitFor(admin, 'state_update', state => state.pendingApprovals.length === 1);
    socket.emit('request_approval', profile);
    const request = (await pending).pendingApprovals[0];
    const joined = waitFor(socket, 'player_joined');
    admin.emit('admin_approve_player', { requestId: request.id });
    const player = await joined;
    assert.equal(jwt.verify(player.sessionToken, secret).sub, player.id);
    const restored = await f.socket();
    assert.equal((await emitAck(restored, 'join_club_room', { clubId: 'club-a', role: 'PLAYER', token: player.sessionToken })).success, true);
    assert.equal((await joinPlayer(restored, { sessionId: player.id })).id, player.id);
  });

  test('approval-only mode requires approval even for players within range', async t => {
    const f = await fixture(t);
    const admin = await f.socket();
    await emitAck(admin, 'join_club_room', adminAuth());
    const socket = await f.socket();
    await joinPlayerRoom(f, socket);
    const changed = waitFor(socket, 'state_update', state => state.requireApproval);
    admin.emit('toggle_require_approval', true);
    await changed;
    const required = waitFor(socket, 'approval_required');
    socket.emit('join_player', { ...profile, ...nearClub });
    assert.match((await required).message, /requires admin approval/);
  });

  test('disconnecting removes pending approval requests', async t => {
    const f = await fixture(t);
    const admin = await f.socket();
    await emitAck(admin, 'join_club_room', adminAuth());
    const socket = await f.socket();
    await joinPlayerRoom(f, socket);
    const pending = waitFor(admin, 'state_update', state => state.pendingApprovals.length === 1);
    socket.emit('request_approval', profile);
    await pending;
    const cleared = waitFor(admin, 'state_update', state => state.pendingApprovals.length === 0);
    socket.disconnect();
    await cleared;
  });

  test('club names persist to SQLite and are broadcast only within their club', async t => {
    const f = await fixture(t);
    const admin = await f.socket();
    await emitAck(admin, 'join_club_room', adminAuth());
    const otherClub = await f.socket();
    await emitAck(otherClub, 'join_club_room', adminAuth('club-b'));
    const renamed = waitFor(admin, 'state_update', state => state.clubName === 'New Club Name');
    assert.equal((await emitAck(admin, 'update_club_name', '  New Club Name  ')).success, true);
    await renamed;
    assert.equal((await query(f.db, 'SELECT name FROM Clubs WHERE id = ?', ['club-a'])).name, 'New Club Name');
    assert.equal((await f.request('/api/clubs/club-a')).name, 'New Club Name');
    assert.equal(otherClub.lastState.clubName, 'Club B');
  });

  test('invalid club names and player attempts to rename a club are rejected', async t => {
    const f = await fixture(t);
    const admin = await f.socket();
    await emitAck(admin, 'join_club_room', adminAuth());
    for (const name of ['', '  ', 'x'.repeat(121), null]) {
      assert.equal((await emitAck(admin, 'update_club_name', name)).success, false);
    }
    const socket = await f.socket();
    await joinPlayerRoom(f, socket);
    assert.equal((await emitAck(socket, 'update_club_name', 'Unauthorized change')).success, false);
    assert.equal((await query(f.db, 'SELECT name FROM Clubs WHERE id = ?', ['club-a'])).name, 'Club A');
  });

  test('switching clubs leaves the previous room and revokes previous admin privileges', async t => {
    const f = await fixture(t);
    const socket = await f.socket();
    await emitAck(socket, 'join_club_room', adminAuth());
    await joinPlayerRoom(f, socket, 'club-b', '5678');
    assert.equal((await emitAck(socket, 'update_club_name', 'Forbidden')).success, false);
    const admin = await f.socket();
    await emitAck(admin, 'join_club_room', adminAuth());
    await emitAck(admin, 'update_club_name', 'Changed Club A');
    assert.equal(socket.lastState.clubName, 'Club B');
  });

  test('leaving a club room revokes the socket authorization', async t => {
    const f = await fixture(t);
    const socket = await f.socket();
    await emitAck(socket, 'join_club_room', adminAuth());
    socket.emit('leave_club_room', { clubId: 'club-a' });
    assert.equal((await emitAck(socket, 'update_club_name', 'Forbidden')).success, false);
  });

  test('the admin connection helper re-authenticates after a socket reconnect', async t => {
    const { connectToClub } = await import('../../../client/src/clubConnection.js');
    const f = await fixture(t);
    const socket = await f.socket();
    const firstState = waitFor(socket, 'state_update');
    const cleanup = connectToClub(socket, adminAuth());
    t.after(cleanup);
    await firstState;
    socket.disconnect();
    const rejoined = waitFor(socket, 'state_update');
    socket.connect();
    await rejoined;
    assert.equal((await emitAck(socket, 'update_club_name', 'After Reconnect')).success, true);
    assert.equal((await query(f.db, 'SELECT name FROM Clubs WHERE id = ?', ['club-a'])).name, 'After Reconnect');
  });

  test('clearing a club location persists and malformed map links preserve the existing GPS gate', async t => {
    const f = await fixture(t);
    const admin = await f.socket();
    await emitAck(admin, 'join_club_room', adminAuth());
    const invalid = waitFor(admin, 'error');
    admin.emit('update_club_location', 'not-a-url');
    assert.match(await invalid, /Could not extract/);
    assert.equal((await query(f.db, 'SELECT lat FROM Clubs WHERE id = ?', ['club-a'])).lat, nearClub.lat);
    const cleared = waitFor(admin, 'state_update', state => state.clubLat === null);
    admin.emit('update_club_location', '');
    await cleared;
    const club = await query(f.db, 'SELECT mapUrl, lat, lng FROM Clubs WHERE id = ?', ['club-a']);
    assert.deepEqual(club, { mapUrl: null, lat: null, lng: null });
  });

  test('malformed player profiles are rejected before creating a player', async t => {
    const f = await fixture(t);
    const socket = await f.socket();
    await joinPlayerRoom(f, socket);
    for (const details of [{ ...profile, name: '' }, { ...profile, level: 11 }, { ...profile, level: 'invalid' }, { ...profile, customAvatar: 'javascript:alert(1)' }, null]) {
      const error = waitFor(socket, 'error');
      socket.emit('join_player', details);
      assert.match(await error, /Invalid player details/);
    }
  });

  test('location updates accept real zero coordinates and acknowledge invalid links without changing GPS', async t => {
    const f = await fixture(t);
    const admin = await f.socket();
    await emitAck(admin, 'join_club_room', adminAuth());
    assert.equal((await emitAck(admin, 'update_club_location', 'https://www.google.com/maps/@0,0,15z')).success, true);
    assert.deepEqual(await query(f.db, 'SELECT lat, lng FROM Clubs WHERE id = ?', ['club-a']), { lat: 0, lng: 0 });
    for (const url of ['not-a-url', 'http://127.0.0.1/maps/@52.1,4.3', 'https://example.com/maps/@52.1,4.3']) {
      assert.equal((await emitAck(admin, 'update_club_location', url)).success, false);
      assert.deepEqual(await query(f.db, 'SELECT lat, lng FROM Clubs WHERE id = ?', ['club-a']), { lat: 0, lng: 0 });
    }
  });

  test('a database write failure reports an error and preserves the live club name', async t => {
    const f = await fixture(t);
    const admin = await f.socket();
    await emitAck(admin, 'join_club_room', adminAuth());
    await new Promise((resolve, reject) => f.db.exec('DROP TABLE Clubs', err => err ? reject(err) : resolve()));
    const result = await emitAck(admin, 'update_club_name', 'Not saved');
    assert.equal(result.success, false);
    assert.match(result.error, /Failed to save/);
    assert.equal(admin.lastState.clubName, 'Club A');
  });

}

module.exports = { defineSessionTests };
