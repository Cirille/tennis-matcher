const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { io } = require('socket.io-client');
const { createTennisServer } = require('../../app');
const { MemorySocketServer, request: memoryRequest } = require('./memory-transport');
const { backup } = require('../../scripts/backup');

function defineLaunchTests({ network = false } = {}) {
  const secret = 'isolated-regression-secret';
  const logger = { info() {}, warn() {}, error() {} };
  const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, error => error ? reject(error) : resolve()));
  const get = (db, sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
  const token = (id = 1, role = 'OWNER', clubId = 'club-a', version = 0) => jwt.sign({ id, role, clubId, version }, secret, { expiresIn: '1h' });
  const ack = (socket, event, data) => new Promise((resolve, reject) => socket.timeout(5000).emit(event, data, (error, result) => error ? reject(error) : resolve(result)));
  const waitFor = (socket, event, predicate = () => true) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, receive); reject(new Error(`Timed out: ${event}`)); }, 5000);
    function receive(value) { if (predicate(value)) { clearTimeout(timer); socket.off(event, receive); resolve(value); } }
    socket.on(event, receive);
  });
  const envelope = (socket, action, value) => ({ id: crypto.randomUUID(), sessionId: socket.lastState.sessionId, revision: socket.lastState.revision, action, value });
  const command = (socket, action, value) => ack(socket, 'admin_command', envelope(socket, action, value));
  async function fixture(t, filename = ':memory:') {
    let db = new sqlite3.Database(filename);
    let application, memory, url;
    const sockets = [];
    async function start() {
      memory = network ? null : new MemorySocketServer();
      application = createTennisServer({ db, jwtSecret: secret, logger, ...(memory ? { createSocketServer: () => memory } : {}) });
      await application.ready;
      if (network) { await new Promise(resolve => application.server.listen(0, '127.0.0.1', resolve)); url = `http://127.0.0.1:${application.server.address().port}`; }
    }
    await start();
    await application.store.queue(async () => {
      await run(db, "INSERT INTO Clubs (id, name, pin) VALUES ('club-a', 'Club A', '1234'), ('club-b', 'Club B', '5678')");
      const hash = await bcrypt.hash('test-password-123', 4);
      for (const [id, role, clubId] of [[1, 'OWNER', 'club-a'], [2, 'ADMIN', 'club-a'], [3, 'OWNER', 'club-b'], [4, 'ROOT', null]]) await run(db, 'INSERT INTO Admins (id, email, password_hash, role, clubId) VALUES (?, ?, ?, ?, ?)', [id, `staff${id}@test.local`, hash, role, clubId]);
    });
    t.after(async () => { sockets.forEach(s => s.disconnect()); await application.close(); await new Promise(resolve => db.close(resolve)); });
    const request = async (route, { method = 'GET', body, auth = token(), headers = {} } = {}) => {
      headers = { ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...headers };
      if (memory) return memoryRequest(application.app, route, { method, body, headers });
      const response = await fetch(url + route, { method, headers: { ...headers, Connection: 'close', ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, ...await response.json() };
    };
    async function connect() {
      const socket = memory ? memory.client() : io(url, { transports: ['websocket'], autoConnect: false, reconnection: false });
      sockets.push(socket); socket.on('error', () => {}); socket.on('state_update', state => { socket.lastState = state; });
      const connected = waitFor(socket, 'connect'); socket.connect(); await connected; return socket;
    }
    return { get db() { return db; }, get application() { return application; }, request, connect,
      async admin(id = 1, role = 'OWNER', clubId = 'club-a') { const socket = await connect(); assert.equal((await ack(socket, 'join_club_room', { clubId, role: 'ADMIN', token: token(id, role, clubId) })).success, true); return socket; },
      async applicant(clubId = 'club-a', pin = '1234') { const socket = await connect(); const credentials = await request(`/api/clubs/${clubId}/verify-pin`, { method: 'POST', body: { pin }, auth: null }); assert.equal(credentials.status, 200); assert.equal((await ack(socket, 'join_club_room', { clubId, role: 'PLAYER', token: credentials.joinToken })).success, true); return { socket, credentials }; },
      async player(name = 'Player') { const { socket } = await this.applicant(); const joined = waitFor(socket, 'player_joined'); assert.equal((await ack(socket, 'join_player', { name, level: 5, gender: 'Other' })).success, true); return { socket, player: await joined }; },
      async restart() { sockets.forEach(s => s.disconnect()); await application.close(); if (filename !== ':memory:') { await new Promise(resolve => db.close(resolve)); db = new sqlite3.Database(filename); } await start(); }
    };
  }

  test('malformed unauthenticated socket events and login objects never crash the server', async t => {
    const f = await fixture(t); const socket = await f.connect();
    for (const event of ['admin_command', 'admin_move_player', 'admin_approve_player', 'admin_deny_player', 'admin_remove_player', 'join_club_room', 'join_player', 'request_approval']) {
      for (const data of [null, {}, [], 'invalid']) assert.equal((await ack(socket, event, data)).success, false);
    }
    for (const body of [null, {}, { email: 'staff1@test.local', password: {} }, { email: {}, password: 'test-password-123' }]) assert.equal((await f.request('/api/login', { method: 'POST', body, auth: null })).status, 400);
    assert.equal((await f.request('/api/health')).status, 'ok');
  });
  test('two admins cannot overwrite each other; retrying a committed command is idempotent', async t => {
    const f = await fixture(t); const a = await f.admin(); const b = await f.admin(2, 'ADMIN');
    const first = envelope(a, 'add_court', { type: 'Hard' }); const stale = envelope(b, 'add_court', { type: 'Clay' });
    const results = await Promise.all([ack(a, 'admin_command', first), ack(b, 'admin_command', stale)]);
    assert.equal(results.filter(r => r.success).length, 1); assert.equal(results.find(r => !r.success).code, 'CONFLICT');
    const winner = results[0].success ? [a, first] : [b, stale];
    assert.equal((await ack(winner[0], 'admin_command', winner[1])).success, true);
    assert.equal(a.lastState.courts.length, 1); assert.equal(b.lastState.courts.length, 1);
    assert.equal((await get(f.db, "SELECT COUNT(*) AS count FROM AuditLog WHERE action = 'add_court'")).count, 1);
  });
  test('round completion happens once and history keeps names after players leave', async t => {
    const f = await fixture(t); const admin = await f.admin(); const other = await f.admin(2, 'ADMIN');
    const p = await f.player('Alice'); await f.player('Bob');
    assert.equal((await command(admin, 'add_court', { type: 'Hard' })).success, true);
    assert.equal((await command(admin, 'auto_matchmake')).success, true);
    assert.equal((await command(admin, 'toggle_game', true)).success, true);
    assert.equal((await command(admin, 'auto_matchmake')).success, false);
    const finish = envelope(admin, 'toggle_game', false); const duplicate = envelope(other, 'toggle_game', false);
    const results = await Promise.all([ack(admin, 'admin_command', finish), ack(other, 'admin_command', duplicate)]);
    assert.equal(results.filter(r => r.success).length, 1);
    assert.equal(admin.lastState.matchHistory.length, 1);
    assert.equal((await command(admin, 'toggle_game', false)).success, false);
    assert.equal((await command(admin, 'admin_remove_player', { playerId: p.player.id })).success, true);
    assert.equal(admin.lastState.matchHistory[0].participants[p.player.id].name, 'Alice');
  });
  test('deleting occupied courts returns everyone to the waiting list and invalid moves do not strand players', async t => {
    const f = await fixture(t); const admin = await f.admin(); const p = await f.player(); await f.player('Two');
    await command(admin, 'add_court', { type: 'Hard' }); await command(admin, 'auto_matchmake');
    const court = admin.lastState.courts[0];
    assert.equal((await command(admin, 'admin_move_player', { playerId: p.player.id, destCourtId: 'missing', destSide: 'A' })).success, false);
    assert.equal(admin.lastState.players[p.player.id].courtId, court.id);
    assert.equal((await command(admin, 'remove_court', { courtId: court.id })).success, true);
    assert.equal(admin.lastState.idleQueue.length, 2);
    assert.ok(Object.values(admin.lastState.players).every(p => p.courtId === null));
  });
  test('a full court rejects overflow without removing the player from their current place', async t => {
    const f = await fixture(t); const a = await f.admin(); const people = [];
    for (let i = 0; i < 5; i++) people.push(await f.player(`Player ${i}`));
    await command(a, 'add_court', { type: 'Clay' }); await command(a, 'auto_matchmake');
    const id = a.lastState.idleQueue[0];
    assert.equal((await command(a, 'admin_move_player', { playerId: id, destCourtId: a.lastState.courts[0].id, destSide: 'A' })).success, false);
    assert.ok(a.lastState.idleQueue.includes(id));
  });
  test('approval can be handled once; applicants cannot see other profiles or approvals', async t => {
    const f = await fixture(t); const a = await f.admin(); const b = await f.admin(2, 'ADMIN'); const admitted = await f.player('Existing');
    await command(a, 'toggle_require_approval', true);
    const { socket } = await f.applicant();
    await ack(socket, 'request_approval', { name: 'Waiting', level: 6, gender: 'F' });
    assert.deepEqual(socket.lastState.players, {}); assert.deepEqual(socket.lastState.pendingApprovals, []);
    const id = a.lastState.pendingApprovals[0].id;
    assert.equal(Object.hasOwn(a.lastState.pendingApprovals[0], 'socketId'), false);
    const first = envelope(a, 'admin_approve_player', { requestId: id }); const second = envelope(b, 'admin_approve_player', { requestId: id });
    const result = await Promise.all([ack(a, 'admin_command', first), ack(b, 'admin_command', second)]);
    assert.equal(result.filter(r => r.success).length, 1); assert.equal(Object.keys(a.lastState.players).length, 2);
    assert.equal(Object.hasOwn(admitted.socket.lastState.players[admitted.player.id], 'level'), false);
    assert.equal(JSON.stringify(admitted.socket.lastState).includes('currentSocketId'), false);
  });
  test('a committed session survives a real database close/reopen and tokens reconnect players', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tennis-restart-'));
    const f = await fixture(t, path.join(directory, 'test.sqlite')); const admin = await f.admin();
    t.after(() => removeTemp(directory));
    const p = await f.player('Restored'); await f.player('Second');
    await command(admin, 'add_court', { type: 'Hard' }); await command(admin, 'auto_matchmake'); await command(admin, 'toggle_require_approval', true); await command(admin, 'toggle_game', true);
    const sessionId = admin.lastState.sessionId;
    await f.restart();
    const restored = await f.admin();
    assert.equal(restored.lastState.sessionId, sessionId); assert.equal(restored.lastState.gameStarted, true); assert.equal(restored.lastState.requireApproval, true);
    assert.equal(restored.lastState.players[p.player.id].disconnected, true);
    const socket = await f.connect();
    assert.equal((await ack(socket, 'join_club_room', { clubId: 'club-a', role: 'PLAYER', token: p.player.sessionToken })).success, true);
    assert.equal((await ack(socket, 'join_player', { sessionId: p.player.id })).success, true);
    assert.equal((await command(restored, 'toggle_game', false)).success, true); assert.equal(restored.lastState.matchHistory.length, 1);
  });
  test('failed persistence rolls back state, audit and receipt; retry succeeds once storage recovers', async t => {
    const f = await fixture(t); const admin = await f.admin(); const before = structuredClone(admin.lastState);
    await run(f.db, "CREATE TRIGGER reject_save BEFORE UPDATE ON Sessions BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    const cmd = envelope(admin, 'add_court', { type: 'Hard' });
    assert.equal((await ack(admin, 'admin_command', cmd)).success, false); assert.deepEqual(admin.lastState, before);
    assert.equal((await get(f.db, 'SELECT COUNT(*) AS count FROM AuditLog')).count, 0);
    assert.equal((await get(f.db, 'SELECT COUNT(*) AS count FROM CommandReceipts')).count, 0);
    await run(f.db, 'DROP TRIGGER reject_save'); assert.equal((await ack(admin, 'admin_command', cmd)).success, true);
  });
  test('creating a club and its owner is atomic and validates reserved identifiers', async t => {
    const f = await fixture(t); const body = { clubId: 'new-club', clubName: 'New Club', pin: '3434', adminEmail: 'new@test.local', adminPassword: 'long-password-123' };
    const auth = token(4, 'ROOT', null);
    assert.equal((await f.request('/api/root/clubs', { method: 'POST', body: { ...body, clubId: 'admin' }, auth })).status, 400);
    await run(f.db, "CREATE TRIGGER fail_owner BEFORE INSERT ON Admins BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    assert.equal((await f.request('/api/root/clubs', { method: 'POST', body, auth })).status, 500);
    assert.equal(await get(f.db, "SELECT id FROM Clubs WHERE id = 'new-club'"), undefined);
    await run(f.db, 'DROP TRIGGER fail_owner');
    assert.equal((await f.request('/api/root/clubs', { method: 'POST', body, auth })).status, 200);
    assert.equal((await get(f.db, "SELECT role FROM Admins WHERE clubId = 'new-club'")).role, 'OWNER');
  });
  test('staff invitation is single use, admin role cannot manage staff, and cross-club access is denied', async t => {
    const f = await fixture(t);
    assert.equal((await f.request('/api/staff', { auth: token(2, 'ADMIN') })).status, 403);
    const invite = await f.request('/api/staff/invite', { method: 'POST', body: { email: 'invited@test.local', role: 'ADMIN' } });
    assert.equal(invite.status, 200);
    const accepted = await f.request('/api/account/accept', { method: 'POST', auth: null, body: { token: invite.token, password: 'invited-password-123' } });
    assert.equal(accepted.status, 200);
    assert.equal((await f.request('/api/account/accept', { method: 'POST', auth: null, body: { token: invite.token, password: 'invited-password-456' } })).status, 400);
    const login = await f.request('/api/login', { method: 'POST', auth: null, body: { email: 'INVITED@test.local', password: 'invited-password-123' } });
    assert.equal(login.status, 200); assert.equal(login.role, 'ADMIN');
    const socket = await f.connect();
    assert.equal((await ack(socket, 'join_club_room', { clubId: 'club-b', role: 'ADMIN', token: login.token })).success, false);
    assert.equal((await f.request('/api/staff/3', { method: 'PATCH', body: { role: 'ADMIN', active: false } })).status, 404);
  });
  test('deactivation revokes an already-open admin connection and preserves the last owner', async t => {
    const f = await fixture(t); const staff = await f.admin(2, 'ADMIN');
    assert.equal((await f.request('/api/staff/1', { method: 'PATCH', body: { role: 'ADMIN', active: false } })).status, 409);
    assert.equal((await f.request('/api/staff/2', { method: 'PATCH', body: { role: 'ADMIN', active: false } })).status, 200);
    assert.equal((await command(staff, 'add_court', { type: 'Hard' })).success, false);
    assert.equal((await f.request('/api/me', { auth: token(2, 'ADMIN') })).status, 401);
    const socket = await f.connect(); assert.equal((await ack(socket, 'join_club_room', { clubId: 'club-a', role: 'ADMIN', token: token(2, 'ADMIN') })).success, false);
  });
  test('password reset revokes old tokens and expired or revoked invitations fail', async t => {
    const f = await fixture(t); const staff = await f.admin(2, 'ADMIN');
    const link = await f.request('/api/staff/2/reset-link', { method: 'POST' });
    assert.equal((await f.request('/api/account/accept', { method: 'POST', auth: null, body: { token: link.token, password: 'replacement-password' } })).status, 200);
    assert.equal((await command(staff, 'add_court', { type: 'Hard' })).success, false);
    const again = await f.request('/api/staff/2/reset-link', { method: 'POST' });
    await run(f.db, "UPDATE AccountLinks SET expiresAt = '2000-01-01'");
    assert.equal((await f.request('/api/account/accept', { method: 'POST', auth: null, body: { token: again.token, password: 'replacement-password' } })).status, 400);
    const last = await f.request('/api/staff/2/reset-link', { method: 'POST' });
    await f.request('/api/staff/2', { method: 'PATCH', body: { role: 'ADMIN', active: false } });
    assert.equal((await f.request('/api/account/accept', { method: 'POST', auth: null, body: { token: last.token, password: 'replacement-password' } })).status, 400);
  });
  test('PIN rotation invalidates applicants while keeping admitted players connected', async t => {
    const f = await fixture(t); const admin = await f.admin(); const p = await f.player(); const waiting = await f.applicant();
    assert.equal((await command(admin, 'rotate_pin', '9876')).success, true);
    const socket = await f.connect();
    assert.equal((await ack(socket, 'join_club_room', { clubId: 'club-a', role: 'PLAYER', token: waiting.credentials.joinToken })).success, false);
    assert.equal((await ack(p.socket, 'join_player', { sessionId: p.player.id })).success, true);
    assert.equal((await f.request('/api/clubs/club-a/verify-pin', { method: 'POST', body: { pin: '1234' }, auth: null })).status, 401);
  });
  test('session lifecycle archives rounds and prevents prior credentials from joining the next session', async t => {
    const f = await fixture(t); const a = await f.admin(); const p = await f.player(); const oldId = a.lastState.sessionId;
    await command(a, 'toggle_require_approval', true); assert.equal((await command(a, 'end_session')).success, true);
    assert.equal((await f.request('/api/clubs/club-a/verify-pin', { method: 'POST', body: { pin: '1234' }, auth: null })).status, 409);
    assert.equal((await command(a, 'new_session')).success, true); assert.notEqual(a.lastState.sessionId, oldId); assert.equal(a.lastState.requireApproval, true); assert.deepEqual(a.lastState.players, {});
    const s = await f.connect(); assert.equal((await ack(s, 'join_club_room', { clubId: 'club-a', role: 'PLAYER', token: p.player.sessionToken })).success, false);
    assert.equal((await f.request(`/api/sessions/${oldId}`, { auth: token(3, 'OWNER', 'club-b') })).status, 404);
    assert.equal((await f.request(`/api/sessions/${oldId}`, { method: 'DELETE' })).status, 200);
  });
  test('shared-Wi-Fi successful check-ins do not consume the failed PIN allowance', async t => {
    const f = await fixture(t);
    for (let i = 0; i < 80; i++) assert.equal((await f.request('/api/clubs/club-a/verify-pin', { method: 'POST', body: { pin: '1234' }, auth: null })).status, 200);
    for (let i = 0; i < 30; i++) assert.equal((await f.request('/api/clubs/club-a/verify-pin', { method: 'POST', body: { pin: 'bad' }, auth: null })).status, 401);
    assert.equal((await f.request('/api/clubs/club-a/verify-pin', { method: 'POST', body: { pin: 'bad' }, auth: null })).status, 429);
    assert.equal((await f.request('/api/clubs/club-a/verify-pin', { method: 'POST', body: { pin: '1234' }, auth: null })).status, 429);
  });
  test('backup can be opened and checked independently without touching the source', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tennis-backup-'));
    const filename = path.join(directory, 'live.sqlite'); const destination = path.join(directory, 'backup.sqlite');
    const f = await fixture(t, filename); const a = await f.admin(); await f.player('Backed up'); await command(a, 'add_court', { type: 'Hard' });
    t.after(() => removeTemp(directory));
    await backup(filename, destination);
    const restored = new sqlite3.Database(destination, sqlite3.OPEN_READONLY);
    try {
      assert.equal((await get(restored, 'PRAGMA integrity_check')).integrity_check, 'ok');
      const row = await get(restored, 'SELECT data FROM Sessions'); assert.equal(JSON.parse(row.data).courts.length, 1);
      assert.equal(Object.keys(JSON.parse(row.data).players).length, 1);
    } finally { await new Promise(resolve => restored.close(resolve)); }
    await assert.rejects(backup(filename, destination), /never overwritten/);
  });
  test('maintenance removes archived personal data without changing the approval policy', async t => {
    const f = await fixture(t); const a = await f.admin(); await f.player('Private name');
    await command(a, 'toggle_require_approval', true); await command(a, 'end_session');
    await f.application.store.queue(async () => {
      const state = structuredClone(await f.application.store.session('club-a'));
      state.endedAt = '2000-01-01T00:00:00.000Z';
      await f.application.store.save(state); f.application.store.states.set('club-a', state);
      await f.application.store.prune();
    });
    const row = await get(f.db, "SELECT data FROM Sessions WHERE clubId = 'club-a'");
    assert.equal(row.data.includes('Private name'), false);
    assert.equal(JSON.parse(row.data).status, 'ended');
    assert.equal((await command(a, 'new_session')).success, true); assert.equal(a.lastState.requireApproval, true);
  });
  test('regular admins can manage a session but cannot change owner settings', async t => {
    const f = await fixture(t); const a = await f.admin(2, 'ADMIN');
    assert.equal((await command(a, 'add_court', { type: 'Hard' })).success, true);
    for (const [action, value] of [['update_club_name', 'Forbidden'], ['toggle_require_approval', true], ['rotate_pin', '5555']]) assert.equal((await command(a, action, value)).success, false);
    assert.equal(a.lastState.clubName, 'Club A');
  });
  test('two owners cannot simultaneously remove the final owners', async t => {
    const f = await fixture(t);
    await run(f.db, "UPDATE Admins SET role = 'OWNER' WHERE id = 2");
    const results = await Promise.all([
      f.request('/api/staff/1', { method: 'PATCH', body: { role: 'ADMIN', active: false } }),
      f.request('/api/staff/2', { method: 'PATCH', body: { role: 'ADMIN', active: false }, auth: token(2, 'OWNER') })
    ]);
    assert.equal(results.filter(r => r.status === 200).length, 1);
    assert.equal((await get(f.db, "SELECT COUNT(*) AS count FROM Admins WHERE role = 'OWNER' AND active = 1 AND clubId = 'club-a'")).count, 1);
  });
  test('closed check-in rejects new players and preserves reconnect for admitted players', async t => {
    const f = await fixture(t); const a = await f.admin(); const p = await f.player(); const waiting = await f.applicant();
    assert.equal((await command(a, 'set_check_in', false)).success, true);
    assert.equal((await ack(waiting.socket, 'join_player', { name: 'Late', level: 5, gender: 'Other' })).success, false);
    assert.equal((await ack(p.socket, 'join_player', { sessionId: p.player.id })).success, true);
  });
}
function removeTemp(directory) {
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.match(path.basename(resolved), /^tennis-(backup|restart)-/);
  return fs.rm(resolved, { recursive: true, force: true });
}
module.exports = { defineLaunchTests };
