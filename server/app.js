const express = require('express');
const http = require('node:http');
const crypto = require('node:crypto');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { createStore, newSession } = require('./storage');
const { registerApi } = require('./api');
const { applyCommand, assertSession, addPlayer, removeFromCourt, publicState } = require('./session');
const { locationTools } = require('./location');
const { UserError, ensure, object, text, playerDetails, coordinates, limiter } = require('./validation');

function createTennisServer({ db, jwtSecret, corsOrigin = 'http://localhost:5173', logger = console,
  trustProxy = false, createSocketServer = (server, options) => new Server(server, options) }) {
  if (!jwtSecret) throw new Error('JWT_SECRET is required');
  const store = createStore(db);
  const maintenance = () => store.queue(store.prune).catch(error => logger.error(`Retention cleanup failed: ${error.message}`));
  store.ready.then(maintenance).catch(() => {});
  const maintenanceTimer = setInterval(maintenance, 24 * 60 * 60 * 1000).unref();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: '128kb' }));
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  const apiLimit = limiter(1200, 60 * 1000);
  app.use(async (req, res, next) => { apiLimit(req.ip); await store.ready; next(); });
  app.get('/api/health', async (req, res) => {
    await store.queue(() => store.get('SELECT 1 AS ok'));
    res.json({ status: 'ok' });
  });
  const server = http.createServer(app);
  const io = createSocketServer(server, {
    cors: { origin: corsOrigin, methods: ['GET', 'POST'] }, maxHttpBufferSize: 128 * 1024,
    allowRequest: (req, callback) => callback(null, !req.headers.origin || req.headers.origin === corsOrigin)
  });
  const { resolveMapLink, getDistanceFromLatLonInKm } = locationTools(logger);
  const revokeAdmin = id => {
    for (const socket of io.sockets.sockets.values()) if (socket.auth?.id === id) {
      socket.auth = null; socket.isAdmin = false; socket.clubId = null;
      socket.emit('error', 'Unauthorized / Your access changed. Please sign in again.');
    }
  };
  const { authenticate, readToken } = registerApi(app, { store, jwtSecret, revokeAdmin });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const known = error instanceof UserError;
    const malformed = error.type === 'entity.parse.failed' || error.type === 'entity.too.large';
    if (!known && !malformed) logger.error(`API request failed: ${error.message}`);
    res.status(known ? error.status : malformed ? (error.status || 400) : 500).json({ error: known ? error.message : malformed ? 'Invalid request body' : 'Could not save or load data. Please retry.', code: known ? error.code : 'SERVER_ERROR' });
  });
  const clubRecord = async clubId => {
    const club = await store.get('SELECT * FROM Clubs WHERE id = ?', [clubId]);
    ensure(club, 'Club not found', 404); return club;
  };
  const broadcast = async (clubId, targetId) => {
    const state = await store.session(clubId);
    const club = await clubRecord(clubId);
    for (const socket of io.sockets.sockets.values()) {
      if (!socket.connected || socket.clubId !== clubId || (targetId && socket.id !== targetId)) continue;
      if (!socket.auth || socket.auth.exp <= Date.now() / 1000) continue;
      const admitted = state.players[socket.playerId]?.currentSocketId === socket.id;
      socket.emit('state_update', { ...publicState(state, club, socket.isAdmin, admitted), myRole: socket.isAdmin ? socket.auth.role : 'PLAYER' });
    }
  };
  const commit = async state => {
    assertSession(state); state.revision++;
    await store.save(state);
    store.states.set(state.clubId, state);
  };
  const joined = (socket, player, state) => {
    socket.playerId = player.id;
    const sessionToken = jwt.sign({ role: 'PLAYER_SESSION', clubId: state.clubId, session: state.id }, jwtSecret, { subject: player.id, expiresIn: '24h' });
    socket.auth = jwt.decode(sessionToken);
    socket.emit('player_joined', { ...player, sessionToken });
  };
  const adminAuth = async socket => {
    ensure(socket.connected && socket.isAdmin && socket.clubId, 'Unauthorized Admin / Session Expired', 401);
    const admin = await authenticate(socket.auth);
    ensure(['ADMIN', 'OWNER'].includes(admin.role) && admin.clubId === socket.clubId, 'Unauthorized Admin', 403);
    return admin;
  };
  const playerAuth = async socket => {
    ensure(socket.clubId, 'Must join a Club Room first');
    ensure(!socket.isAdmin && socket.auth?.exp > Date.now() / 1000, 'PIN verification required. Please enter the club PIN again.', 401);
    const state = await store.session(socket.clubId);
    ensure(socket.auth.session === state.id && state.status === 'open', 'Session expired. Please join again.', 401);
    if (socket.auth.role === 'PLAYER_JOIN') {
      const club = await clubRecord(socket.clubId);
      ensure(socket.auth.pinVersion === club.pinVersion, 'PIN verification required. Please enter the club PIN again.', 401);
    } else ensure(socket.auth.role === 'PLAYER_SESSION' && Object.hasOwn(state.players, socket.auth.sub), 'Session expired. Please join again.', 401);
    return state;
  };
  let closing = false;
  let pendingEvents = 0;
  const eventLimit = limiter(120, 60 * 1000);
  const addressLimit = limiter(3600, 60 * 1000);
  const mapLimit = limiter(6, 60 * 1000);
  io.on('connection', socket => {
    let joinAttempt = 0;
    const errorReply = (error, ack) => {
      const known = error instanceof UserError;
      if (!known) logger.error(`Socket operation failed: ${error.message}`);
      const message = known ? error.message : 'Failed to save or load data. Please retry.';
      socket.emit('error', message);
      if (typeof ack === 'function') ack({ success: false, error: message, code: known ? error.code : 'SERVER_ERROR' });
    };
    const on = (event, handler, prepare) => socket.on(event, (data, ack) => {
      if (closing) return errorReply(new UserError('Server restarting. Please reconnect.', 503), ack);
      try {
        eventLimit(socket.id); addressLimit(socket.handshake?.address || 'memory');
        ensure(pendingEvents < 1000, 'Server is busy. Please retry.', 429);
      } catch (error) { return errorReply(error, ack); }
      pendingEvents++;
      // Resolve external services outside the database queue so one slow map link
      // cannot stall every club. The queued handler rechecks auth and revision.
      const prepared = prepare ? prepare(data) : Promise.resolve(undefined);
      prepared.then(extra => store.queue(async () => {
        ensure(socket.connected, 'Connection closed');
        const result = await handler(data, extra);
        if (typeof ack === 'function') ack({ success: true, ...result });
      })).catch(error => errorReply(error, ack)).finally(() => { pendingEvents--; });
    });
    const detach = async () => {
      const clubId = socket.clubId;
      const playerId = socket.playerId;
      socket.clubId = null; socket.auth = null; socket.isAdmin = false; socket.playerId = null;
      if (!clubId) return;
      const state = structuredClone(await store.session(clubId));
      const previous = state.pendingApprovals.length;
      state.pendingApprovals = state.pendingApprovals.filter(r => r.socketId !== socket.id);
      const player = state.players[playerId];
      const changed = player?.currentSocketId === socket.id;
      if (changed) { player.disconnected = true; delete player.currentSocketId; }
      if (changed || previous !== state.pendingApprovals.length) { await commit(state); await broadcast(clubId); }
    };
    on('join_club_room', async data => {
      const attempt = ++joinAttempt;
      await detach();
      ensure(object(data) && text(data.clubId, 50) && ['ADMIN', 'PLAYER'].includes(data.role), 'Invalid club room');
      let decoded;
      try { decoded = readToken(data.token); }
      catch { ensure(false, data.role === 'ADMIN' ? 'Unauthorized Admin / Session Expired' : 'PIN verification required. Please enter the club PIN again.', 401); }
      ensure(decoded.clubId === data.clubId && (data.role === 'ADMIN' ? ['ADMIN', 'OWNER'] : ['PLAYER_JOIN', 'PLAYER_SESSION']).includes(decoded.role), 'Unauthorized club access', 403);
      const club = await clubRecord(data.clubId);
      const state = await store.session(data.clubId);
      if (data.role === 'ADMIN') await authenticate(decoded);
      else {
        ensure(decoded.session === state.id && state.status === 'open', 'Session expired. Please join again.', 401);
        if (decoded.role === 'PLAYER_SESSION') ensure(Object.hasOwn(state.players, decoded.sub), 'Session expired. Please join again.', 401);
        else ensure(decoded.pinVersion === club.pinVersion, 'PIN verification required. Please enter the club PIN again.', 401);
      }
      ensure(socket.connected && attempt === joinAttempt, 'Connection changed. Please retry.');
      socket.clubId = data.clubId; socket.isAdmin = data.role === 'ADMIN'; socket.auth = decoded;
      await broadcast(data.clubId, socket.id);
    });
    on('leave_club_room', async data => {
      if (data?.clubId && data.clubId !== socket.clubId) return;
      joinAttempt++; await detach();
    });
    on('join_player', async data => {
      const current = await playerAuth(socket);
      ensure(object(data), 'Invalid player details');
      const state = structuredClone(current);
      if (data.sessionId) {
        ensure(socket.auth.role === 'PLAYER_SESSION' && socket.auth.sub === data.sessionId && Object.hasOwn(state.players, data.sessionId), 'Session expired. Please join again.', 401);
        const player = state.players[data.sessionId];
        const oldSocket = io.sockets.sockets.get(player.currentSocketId);
        player.currentSocketId = socket.id; player.disconnected = false;
        await commit(state);
        if (oldSocket && oldSocket.id !== socket.id) { oldSocket.playerId = null; oldSocket.clubId = null; oldSocket.auth = null; oldSocket.emit('error', 'Session expired. Restored on another connection.'); }
        joined(socket, player, state); await broadcast(state.clubId); return;
      }
      if (socket.playerId && state.players[socket.playerId]?.currentSocketId === socket.id) { joined(socket, state.players[socket.playerId], state); return; }
      ensure(socket.auth.role === 'PLAYER_JOIN', 'Session expired. Please join again.');
      ensure(playerDetails(data), 'Invalid player details');
      ensure(state.checkInOpen, 'Check-in is closed');
      const club = await clubRecord(socket.clubId);
      if (state.requireApproval) { socket.emit('approval_required', { message: 'This club requires admin approval to join.' }); return; }
      if (coordinates(club.lat, club.lng)) {
        if (!coordinates(data.lat, data.lng)) { socket.emit('approval_required', { message: 'Location could not be verified. Please request admin approval to join.' }); return; }
        const distance = getDistanceFromLatLonInKm(club.lat, club.lng, data.lat, data.lng);
        if (distance > 2) { socket.emit('gps_failed', { distance: Math.round(distance * 10) / 10 }); return; }
      }
      const player = addPlayer(state, data, socket.id);
      state.pendingApprovals = state.pendingApprovals.filter(r => r.socketId !== socket.id);
      await commit(state); joined(socket, player, state); await broadcast(state.clubId);
    });
    on('request_approval', async data => {
      const state = structuredClone(await playerAuth(socket));
      ensure(socket.auth.role === 'PLAYER_JOIN', 'You have already joined this session.');
      ensure(playerDetails(data), 'Invalid player details');
      ensure(state.checkInOpen, 'Check-in is closed');
      ensure(!state.pendingApprovals.some(r => r.socketId === socket.id), 'You already have a pending approval request.');
      ensure(state.pendingApprovals.length < 100, 'Approval queue is full. Please try again shortly.');
      const club = await clubRecord(socket.clubId);
      state.pendingApprovals.push({ id: crypto.randomUUID(), socketId: socket.id, name: data.name.trim(), level: Number(data.level), gender: data.gender,
        avatar: data.customAvatar || '/avatar.svg', distance: coordinates(club.lat, club.lng) && coordinates(data.lat, data.lng) ? Math.round(getDistanceFromLatLonInKm(club.lat, club.lng, data.lat, data.lng) * 10) / 10 : null });
      await commit(state); await broadcast(state.clubId);
    });
    on('player_exit', async () => {
      const state = structuredClone(await playerAuth(socket));
      ensure(!state.gameStarted, 'Game is in progress.');
      ensure(state.players[socket.playerId]?.currentSocketId === socket.id, 'Session expired. Please join again.');
      removeFromCourt(state, socket.playerId); delete state.players[socket.playerId];
      await commit(state); socket.playerId = null; socket.auth = null; socket.clubId = null;
      await broadcast(state.clubId);
    });
    on('admin_command', async (command, resolvedLocation) => {
      const admin = await adminAuth(socket);
      ensure(object(command) && text(command.id, 80) && text(command.action, 50) && Number.isInteger(command.revision) && text(command.sessionId, 80), 'Invalid command. Reload the page.');
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify(command)).digest('hex');
      const receipt = await store.get('SELECT * FROM CommandReceipts WHERE clubId = ? AND adminId = ? AND commandId = ?', [admin.clubId, admin.id, command.id]);
      if (receipt) {
        ensure(receipt.fingerprint === fingerprint, 'Command identifier already used', 409);
        await broadcast(admin.clubId, socket.id); return JSON.parse(receipt.result);
      }
      let state = structuredClone(await store.session(admin.clubId));
      if (command.revision !== state.revision || command.sessionId !== state.id) {
        await broadcast(admin.clubId, socket.id);
        ensure(false, 'Session changed on another screen. Review the updated state and try again.', 409, 'CONFLICT');
      }
      const { action, value } = command;
      const effects = [];
      let settings = null;
      if (['update_club_name', 'update_club_location', 'rotate_pin', 'toggle_require_approval'].includes(action)) ensure(admin.role === 'OWNER', 'Club owner access required', 403);
      if (action === 'new_session') {
        ensure(state.status === 'ended', 'End the current session first'); state = newSession(admin.clubId, state);
      } else if (action === 'update_club_name') {
        ensure(text(value, 120), 'Club name must be between 1 and 120 characters.'); settings = { name: value.trim() };
      } else if (action === 'update_club_location') {
        ensure(typeof value === 'string' && value.length <= 2048, 'Invalid map link');
        const mapUrl = value.trim();
        const coords = resolvedLocation;
        ensure(coords, 'Could not extract valid GPS coordinates from the provided map link.'); settings = { mapUrl: mapUrl || null, ...coords };
      } else if (action === 'rotate_pin') {
        ensure(typeof value === 'string' && /^\d{4,12}$/.test(value), 'PIN must contain 4–12 digits'); settings = { pin: value };
        state.pendingApprovals = [];
      } else if (['admin_approve_player', 'admin_deny_player'].includes(action)) {
        ensure(state.status === 'open' && state.checkInOpen, 'Check-in is closed');
        ensure(object(value) && text(value.requestId, 80), 'Invalid approval request');
        const request = state.pendingApprovals.find(r => r.id === value.requestId);
        ensure(request, 'This request has already been handled', 409, 'CONFLICT');
        const target = io.sockets.sockets.get(request.socketId);
        ensure(target?.connected && target.clubId === admin.clubId, 'This player is no longer connected.');
        await playerAuth(target);
        ensure(target.auth.role === 'PLAYER_JOIN', 'This player has already joined');
        state.pendingApprovals = state.pendingApprovals.filter(r => r.id !== request.id);
        if (action === 'admin_approve_player') { const player = addPlayer(state, request, target.id); effects.push(() => joined(target, player, state)); }
        else effects.push(() => target.emit('approval_denied', { message: 'Your request to join has been denied by the admin.' }));
      } else {
        const removed = action === 'admin_remove_player' && state.players[value?.playerId];
        applyCommand(state, action, value);
        if (removed) effects.push(() => {
          const target = io.sockets.sockets.get(removed.currentSocketId);
          if (target) { target.auth = null; target.clubId = null; target.playerId = null; target.emit('player_removed', { message: 'You have been removed from the session by the admin.' }); }
        });
      }
      await adminAuth(socket);
      assertSession(state); state.revision++;
      const result = { revision: state.revision, sessionId: state.id };
      await store.transaction(async () => {
        if (settings?.name) await store.run('UPDATE Clubs SET name = ? WHERE id = ?', [settings.name, admin.clubId]);
        if (settings && Object.hasOwn(settings, 'mapUrl')) await store.run('UPDATE Clubs SET mapUrl = ?, lat = ?, lng = ? WHERE id = ?', [settings.mapUrl, settings.lat, settings.lng, admin.clubId]);
        if (settings?.pin) await store.run('UPDATE Clubs SET pin = ?, pinVersion = pinVersion + 1 WHERE id = ?', [settings.pin, admin.clubId]);
        if (action === 'toggle_require_approval') await store.run('UPDATE Clubs SET requireApproval = ? WHERE id = ?', [Number(state.requireApproval), admin.clubId]);
        await store.save(state);
        await store.audit(admin.clubId, admin.id, action, state.id);
        await store.run('INSERT INTO CommandReceipts VALUES (?, ?, ?, ?, ?, ?)', [admin.clubId, admin.id, command.id, fingerprint, JSON.stringify(result), new Date().toISOString()]);
      });
      store.states.set(admin.clubId, state);
      for (const effect of effects) effect();
      if (action === 'end_session' || action === 'rotate_pin') {
        for (const target of io.sockets.sockets.values()) if (target.clubId === admin.clubId && !target.isAdmin && (action === 'end_session' || target.auth?.role === 'PLAYER_JOIN')) {
          target.auth = null; target.clubId = null; target.playerId = null;
          target.emit('error', action === 'end_session' ? 'Session expired. This session has ended.' : 'PIN verification required. The club PIN changed.');
        }
      }
      await broadcast(admin.clubId); return result;
    }, async command => {
      if (command?.action !== 'update_club_location') return;
      await store.queue(async () => {
        const admin = await adminAuth(socket);
        ensure(admin.role === 'OWNER', 'Club owner access required', 403);
        ensure(typeof command.value === 'string' && command.value.length <= 2048, 'Invalid map link');
      });
      mapLimit(socket.auth.id);
      const mapUrl = command.value.trim();
      return mapUrl ? resolveMapLink(mapUrl) : { lat: null, lng: null };
    });
    // Reject unversioned writes from older cached clients.
    for (const event of ['update_courts', 'update_club_name', 'update_club_location', 'toggle_game', 'auto_matchmake', 'admin_move_player', 'admin_approve_player', 'admin_deny_player', 'admin_remove_player', 'toggle_require_approval']) {
      on(event, async () => { await adminAuth(socket); ensure(false, 'Your app version is outdated. Reload this page.'); });
    }
    socket.on('disconnect', () => {
      joinAttempt++;
      store.queue(detach).catch(error => logger.error(`Disconnect cleanup failed: ${error.message}`));
    });
  });
  return { app, server, io, ready: store.ready, store,
    close: async () => {
      closing = true;
      clearInterval(maintenanceTimer);
      await new Promise(resolve => io.close(resolve));
      await store.drain();
    }
  };
}
module.exports = { createTennisServer };
