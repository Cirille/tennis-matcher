const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');

const { autoMatchmake } = require('./matchmaker');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

function createTennisServer({
  db, jwtSecret, corsOrigin = 'http://localhost:5173', logger = console,
  createSocketServer = (server, options) => new Server(server, options)
}) {
  const CORS_ORIGIN = corsOrigin;
  const JWT_SECRET = jwtSecret;
  if (!JWT_SECRET) throw new Error('JWT_SECRET is required');

  const app = express();
  app.use(cors({ origin: CORS_ORIGIN }));
  app.use(express.json());

  // ----------------------------------------
  // EXPRESS API - Auth & Dashboards
  // ----------------------------------------
  app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

    db.get("SELECT * FROM Admins WHERE email = ?", [email], (err, admin) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!admin) return res.status(401).json({ error: 'Invalid email or password' });

      if (bcrypt.compareSync(password, admin.password_hash)) {
        const token = jwt.sign({ id: admin.id, role: admin.role, clubId: admin.clubId }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, role: admin.role, clubId: admin.clubId });
      } else {
        res.status(401).json({ error: 'Invalid email or password' });
      }
    });
  });

  const verifyRoot = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err || decoded.role !== 'ROOT') return res.status(403).json({ error: 'Unauthorized: Root access required' });
      req.user = decoded;
      next();
    });
  };

  app.post('/api/root/clubs', verifyRoot, (req, res) => {
    const { clubId, clubName, pin, adminEmail, adminPassword } = req.body;

    db.get("SELECT * FROM Clubs WHERE id = ?", [clubId], (err, row) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (row) return res.status(400).json({ error: 'Club Identifier (URL Slug) already exists.' });

      db.get("SELECT * FROM Admins WHERE email = ?", [adminEmail], (err, adminRow) => {
        if (adminRow) return res.status(400).json({ error: 'Admin Email already exists.' });

        const hash = bcrypt.hashSync(adminPassword, 10);
        db.run("INSERT INTO Clubs (id, name, pin, mapUrl, lat, lng) VALUES (?, ?, ?, ?, ?, ?)",
          [clubId, clubName, pin, null, null, null], (err) => {
            if (err) return res.status(500).json({ error: 'Failed creating club record' });

            db.run("INSERT INTO Admins (email, password_hash, role, clubId) VALUES (?, ?, ?, ?)",
              [adminEmail, hash, 'ADMIN', clubId], (err) => {
                if (err) return res.status(500).json({ error: 'Failed creating admin record' });
                res.json({ success: true, clubId });
            });
        });
      });
    });
  });

  app.get('/api/root/clubs', verifyRoot, (req, res) => {
    db.all("SELECT id, name, pin FROM Clubs", [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  // Used by PlayerScreen to fetch club name before joining
  app.get('/api/clubs/:id', (req, res) => {
    db.get("SELECT name, mapUrl, lat, lng FROM Clubs WHERE id = ?", [req.params.id], (err, row) => {
      if (err || !row) return res.status(404).json({ error: 'Club not found' });
      res.json(row);
    });
  });

  // Step 1 of Kahoot Auth
  app.post('/api/clubs/:id/verify-pin', (req, res) => {
    const { pin } = req.body || {};
    if (typeof pin !== 'string' || !pin || pin.length > 128) return res.status(400).json({ error: 'PIN required' });
    db.get("SELECT pin FROM Clubs WHERE id = ?", [req.params.id], (err, row) => {
      if (err || !row) return res.status(404).json({ error: 'Club not found' });
      if (row.pin === pin) {
        const joinToken = jwt.sign({ role: 'PLAYER_JOIN', clubId: req.params.id }, JWT_SECRET, { expiresIn: '30m' });
        res.json({ success: true, joinToken });
      }
      else res.status(401).json({ error: 'Invalid PIN' });
    });
  });

  // ----------------------------------------
  // SOCKET.IO MULTI-TENANT SERVER
  // ----------------------------------------
  const server = http.createServer(app);
  const io = createSocketServer(server, {
    cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] }
  });

  const clubStates = Object.create(null);

  const getClubState = (clubId, club = {}) => {
    if (!clubStates[clubId]) {
      clubStates[clubId] = {
        clubName: club.name || 'Loading...',
        gameStarted: false,
        clubMapUrl: club.mapUrl ?? null, clubLat: club.lat ?? null, clubLng: club.lng ?? null,
        courts: [], players: {}, idleQueue: [],
        disconnectTimers: {}, idleAtStart: new Set(), matchHistory: [],
        pendingApprovals: [],
        requireApproval: false
      };
    }
    return clubStates[clubId];
  };

  const broadcastState = (clubId, emitToId = null) => {
    const state = getClubState(clubId);
    const payload = {
      clubName: state.clubName,
      gameStarted: state.gameStarted,
      courts: state.courts,
      idleQueue: state.idleQueue,
      players: state.players,
      clubMapUrl: state.clubMapUrl,
      clubLat: state.clubLat,
      clubLng: state.clubLng,
      matchHistory: state.matchHistory,
      pendingApprovals: state.pendingApprovals,
      requireApproval: state.requireApproval
    };
    if (emitToId) {
      io.to(emitToId).emit('state_update', payload);
    } else {
      io.to(`club:${clubId}`).emit('state_update', payload);
    }
  };

  // Map extractors
  const extractLatLng = (urlStr) => {
    const regex = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/;
    const match = urlStr.match(regex);
    if (match) {
      const coords = { lat: Number(match[1]), lng: Number(match[2]) };
      if (validCoordinates(coords.lat, coords.lng)) return coords;
    }
    return null;
  };
  const resolveMapLink = async (urlStr) => {
    try {
      const url = new URL(urlStr);
      const mapHosts = new Set(['google.com', 'www.google.com', 'maps.google.com', 'maps.app.goo.gl', 'goo.gl']);
      if (url.protocol !== 'https:' || !mapHosts.has(url.hostname) || url.username || url.password) return null;
      const directCoords = extractLatLng(urlStr);
      if (directCoords) return directCoords;
      return await new Promise((resolve) => {
        const request = https.get(url, { timeout: 3000 }, (res) => {
          res.resume();
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            try {
              const target = new URL(res.headers.location, url);
              if (target.protocol === 'https:' && mapHosts.has(target.hostname)) {
                const coords = extractLatLng(target.href);
                if (coords) return resolve(coords);
              }
            } catch {
              return resolve(null);
            }
          }
          resolve(null);
        });
        request.on('error', (e) => {
          logger.error(`Map resolution error: ${e.message}`);
          resolve(null);
        });
        request.on('timeout', () => {
          request.destroy();
          logger.warn(`Map resolution request timed out for url: ${urlStr}`);
          resolve(null);
        });
      });
    } catch (e) {
      logger.error(`Map resolution exception: ${e.message}`);
      return null;
    }
  };

  const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI/180);
    const dLon = (lon2 - lon1) * (Math.PI/180);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * (Math.PI/180)) * Math.cos(lat2 * (Math.PI/180)) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  // Core Sockets
  const validCoordinates = (lat, lng) => typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90
    && typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180;

  const sendPlayerJoined = (socketId, player, clubId) => {
    const sessionToken = jwt.sign({ role: 'PLAYER_SESSION', clubId }, JWT_SECRET, { subject: player.id, expiresIn: '24h' });
    io.to(socketId).emit('player_joined', { ...player, sessionToken });
  };

  const adminAuthorized = (socket) => socket.isAdmin && socket.clubId && socket.auth?.exp > Date.now() / 1000;

  const validPlayerDetails = (data) => typeof data?.name === 'string' && data.name.trim().length > 0 && data.name.trim().length <= 80
    && Number.isInteger(Number(data.level)) && Number(data.level) >= 1 && Number(data.level) <= 10
    && ['M', 'F', 'Other'].includes(data.gender)
    && (data.customAvatar == null || (typeof data.customAvatar === 'string' && data.customAvatar.length <= 100000
      && /^data:image\/(jpeg|png|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(data.customAvatar)));

  io.on('connection', (socket) => {
    logger.info(`User connected: ${socket.id}`);

    // 1. Join isolated Room
    let joinAttempt = 0;
    const detachClub = () => {
      if (!socket.clubId) return;
      const clubId = socket.clubId;
      markDisconnected(clubId);
      socket.leave(`club:${clubId}`);
      socket.clubId = null;
      socket.isAdmin = false;
      socket.auth = null;
    };

    socket.on('join_club_room', (data, acknowledge) => {
      const attempt = ++joinAttempt;
      detachClub();
      const fail = (error) => {
        socket.emit('error', error);
        if (typeof acknowledge === 'function') acknowledge({ success: false, error });
      };
      const { clubId, role, token } = data || {};
      if (typeof clubId !== 'string' || !clubId || !['ADMIN', 'PLAYER'].includes(role)) return fail('Invalid club room');
      let decoded;
      try {
        decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
      } catch {
        return fail(role === 'ADMIN' ? 'Unauthorized Admin / Session Expired' : 'PIN verification required. Please enter the club PIN again.');
      }
      const allowedRoles = role === 'ADMIN' ? ['ADMIN'] : ['PLAYER_JOIN', 'PLAYER_SESSION'];
      if (decoded.clubId !== clubId || !allowedRoles.includes(decoded.role)) return fail('Unauthorized club access');

      db.get('SELECT name, mapUrl, lat, lng FROM Clubs WHERE id = ?', [clubId], (err, club) => {
        if (attempt !== joinAttempt || !socket.connected) return;
        if (err) return fail('Database error');
        if (!club) return fail('Club not found');
        const state = getClubState(clubId, club);
        if (decoded.role === 'PLAYER_SESSION' && !state.players[decoded.sub]) return fail('Session expired. Please join again.');
        socket.join(`club:${clubId}`);
        socket.clubId = clubId;
        socket.isAdmin = role === 'ADMIN';
        socket.auth = decoded;
        broadcastState(clubId, socket.id);
        if (typeof acknowledge === 'function') acknowledge({ success: true });
      });
    });

    socket.on('leave_club_room', (data) => {
      if (data?.clubId && socket.clubId && data.clubId !== socket.clubId) return;
      joinAttempt += 1;
      detachClub();
    });

    const generateAvatar = (name) => `https://api.dicebear.com/7.x/pixel-art/svg?seed=${encodeURIComponent(name + Date.now())}`;

    const getSessionIdBySocket = (socketId, state) => {
      for (const [sId, p] of Object.entries(state.players)) {
        if (p.currentSocketId === socketId) return sId;
      }
      return null;
    };

    // 2. Play Actions
    socket.on('join_player', (data = {}) => {
      if (!socket.clubId) return socket.emit('error', 'Must join a Club Room first (Internal routing error)');
      if (!socket.auth || socket.isAdmin || socket.auth.exp <= Date.now() / 1000) return socket.emit('error', 'PIN verification required. Please enter the club PIN again.');
      if (!data || typeof data !== 'object') return socket.emit('error', 'Invalid player details');
      const state = getClubState(socket.clubId);

      if (data.sessionId) {
        if (socket.auth.role !== 'PLAYER_SESSION' || socket.auth.sub !== data.sessionId) return socket.emit('error', 'Session expired. Please join again.');
        if (state.players[data.sessionId]) {
          const player = state.players[data.sessionId];
          player.currentSocketId = socket.id;
          player.disconnected = false;
          if (state.disconnectTimers[data.sessionId]) {
            clearTimeout(state.disconnectTimers[data.sessionId]);
            delete state.disconnectTimers[data.sessionId];
          }
          sendPlayerJoined(socket.id, player, socket.clubId);
          broadcastState(socket.clubId);
          return;
        } else {
          socket.emit('error', 'Session expired. Please join again.');
          return;
        }
      }

      const existingSession = getSessionIdBySocket(socket.id, state);
      if (existingSession && state.players[existingSession]) {
        sendPlayerJoined(socket.id, state.players[existingSession], socket.clubId);
        return;
      }

      if (socket.auth.role !== 'PLAYER_JOIN') return socket.emit('error', 'Session expired. Please join again.');
      if (!validPlayerDetails(data)) return socket.emit('error', 'Invalid player details');

      // If admin requires approval for ALL players (GPS verification disabled)
      if (state.requireApproval) {
        socket.emit('approval_required', { message: 'This club requires admin approval to join.' });
        return;
      }

      // If GPS is set, validate distance
      if (validCoordinates(state.clubLat, state.clubLng)) {
        if (!validCoordinates(data.lat, data.lng)) {
          socket.emit('approval_required', { message: 'Location could not be verified. Please request admin approval to join.' });
          return;
        }
        const dist = getDistanceFromLatLonInKm(state.clubLat, state.clubLng, data.lat, data.lng);
        if (dist > 2.0) {
          socket.emit('gps_failed', { distance: Math.round(dist * 10) / 10 });
          return;
        }
      }

      const sessionId = crypto.randomUUID();
      const newPlayer = {
        id: sessionId,
        currentSocketId: socket.id,
        name: data.name.trim(),
        level: Number(data.level),
        gender: data.gender,
        avatar: data.customAvatar || generateAvatar(data.name),
        idle_rounds: 0,
        courtId: null,
        side: null,
        disconnected: false
      };
      state.players[sessionId] = newPlayer;
      if (!state.idleQueue.includes(sessionId)) state.idleQueue.push(sessionId);

      sendPlayerJoined(socket.id, newPlayer, socket.clubId);
      broadcastState(socket.clubId);
    });

    // Admin Config Actions
    socket.on('update_club_name', (name, acknowledge) => {
      const fail = (error) => {
        socket.emit('error', error);
        if (typeof acknowledge === 'function') acknowledge({ success: false, error });
      };
      if (!adminAuthorized(socket)) return fail('Unauthorized Admin / Session Expired');
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) return fail('Club name must be between 1 and 120 characters.');
      const clubId = socket.clubId;
      const clubName = name.trim();
      db.run('UPDATE Clubs SET name = ? WHERE id = ?', [clubName, clubId], (err) => {
        if (err) return fail('Failed to save club name');
        getClubState(clubId).clubName = clubName;
        broadcastState(clubId);
        if (typeof acknowledge === 'function') acknowledge({ success: true });
      });
    });

    socket.on('update_courts', (newCourts) => {
      if (!adminAuthorized(socket)) return;
      getClubState(socket.clubId).courts = newCourts;
      broadcastState(socket.clubId);
    });

    socket.on('update_club_location', async (urlStr, acknowledge) => {
      const fail = (error) => {
        socket.emit('error', error);
        if (typeof acknowledge === 'function') acknowledge({ success: false, error });
      };
      if (!adminAuthorized(socket)) return fail('Unauthorized Admin / Session Expired');
      if (typeof urlStr !== 'string' || urlStr.length > 2048) return fail('Invalid map link');
      const clubId = socket.clubId;
      const state = getClubState(clubId);
      const revision = (state.locationRevision || 0) + 1;
      state.locationRevision = revision;
      const mapUrl = urlStr.trim();
      const coords = mapUrl ? await resolveMapLink(mapUrl) : { lat: null, lng: null };
      if (!coords) return fail('Could not extract valid GPS coordinates from the provided map link.');
      if (!adminAuthorized(socket) || socket.clubId !== clubId) return fail('Unauthorized Admin / Session Expired');
      if (state.locationRevision !== revision) return fail('A newer location update replaced this request.');
      db.run('UPDATE Clubs SET mapUrl=?, lat=?, lng=? WHERE id=?', [mapUrl || null, coords.lat, coords.lng, clubId], (err) => {
        if (err) return fail('Failed to save club location');
        state.clubMapUrl = mapUrl || null;
        state.clubLat = coords.lat;
        state.clubLng = coords.lng;
        broadcastState(clubId);
        if (typeof acknowledge === 'function') acknowledge({ success: true });
      });
    });

    socket.on('toggle_game', (started) => {
      if (!adminAuthorized(socket)) return;
      const state = getClubState(socket.clubId);
      state.gameStarted = started;

      if (started) {
        state.idleAtStart = new Set(state.idleQueue);
      } else {
        const roundNumber = state.matchHistory.length + 1;
        const savedCourts = state.courts.map(c => ({
          id: c.id, number: c.number, type: c.type, sideA: [...(c.sideA || [])], sideB: [...(c.sideB || [])]
        }));
        state.matchHistory.push({ roundNumber, courts: savedCourts });

        state.courts.forEach(c => {
          if (c.sideA) c.sideA.forEach(id => { if (state.players[id]) state.players[id].idle_rounds = 0; });
          if (c.sideB) c.sideB.forEach(id => { if (state.players[id]) state.players[id].idle_rounds = 0; });
        });
        state.idleQueue.forEach(id => {
          if (state.players[id] && state.idleAtStart.has(id)) state.players[id].idle_rounds += 1;
        });
        state.idleAtStart.clear();
      }
      broadcastState(socket.clubId);
    });

    socket.on('auto_matchmake', () => {
      if (!adminAuthorized(socket)) return;
      const state = getClubState(socket.clubId);
      state.idleQueue = autoMatchmake(state.courts, state.players, state.idleQueue, state.matchHistory);
      broadcastState(socket.clubId);
    });

    socket.on('admin_move_player', ({ playerId, sourceCourtId, sourceSide, destCourtId, destSide }) => {
      if (!adminAuthorized(socket)) return;
      const state = getClubState(socket.clubId);
      const player = state.players[playerId];
      if(!player) return;

      if (sourceCourtId === 'idle') {
        state.idleQueue = state.idleQueue.filter(id => id !== playerId);
      } else {
        const sCourt = state.courts.find(c => c.id === sourceCourtId);
        if(sCourt) {
          if(sourceSide === 'A') sCourt.sideA = sCourt.sideA.filter(id => id !== playerId);
          if(sourceSide === 'B') sCourt.sideB = sCourt.sideB.filter(id => id !== playerId);
        }
      }

      if (destCourtId === 'idle') {
        player.courtId = null; player.side = null;
        state.idleQueue.push(playerId);
        if (state.gameStarted) state.idleAtStart.add(playerId);
      } else {
        const dCourt = state.courts.find(c => c.id === destCourtId);
        if(dCourt) {
          player.courtId = destCourtId; player.side = destSide;
          if(destSide === 'A') dCourt.sideA.push(playerId);
          if(destSide === 'B') dCourt.sideB.push(playerId);
          if (state.gameStarted) state.idleAtStart.delete(playerId);
        }
      }
      broadcastState(socket.clubId);
    });

    // ---- GPS Approval Flow ----
    socket.on('request_approval', (data = {}) => {
      if (!socket.clubId) return;
      if (socket.auth?.role !== 'PLAYER_JOIN' || socket.auth.exp <= Date.now() / 1000) return socket.emit('error', 'PIN verification required. Please enter the club PIN again.');
      if (!validPlayerDetails(data)) return socket.emit('error', 'Invalid player details');
      const state = getClubState(socket.clubId);
      if (getSessionIdBySocket(socket.id, state)) return socket.emit('error', 'You have already joined this session.');

      // Prevent duplicate requests from same socket
      if (state.pendingApprovals.find(p => p.socketId === socket.id)) {
        socket.emit('error', 'You already have a pending approval request.');
        return;
      }

      const generateAvatar2 = (name) => `https://api.dicebear.com/7.x/pixel-art/svg?seed=${encodeURIComponent(name + Date.now())}`;
      const request = {
        id: crypto.randomUUID(),
        socketId: socket.id,
        name: data.name.trim(),
        level: Number(data.level),
        gender: data.gender,
        avatar: data.customAvatar || generateAvatar2(data.name),
        distance: validCoordinates(state.clubLat, state.clubLng) && validCoordinates(data.lat, data.lng)
          ? Math.round(getDistanceFromLatLonInKm(state.clubLat, state.clubLng, data.lat, data.lng) * 10) / 10 : null
      };
      state.pendingApprovals.push(request);
      broadcastState(socket.clubId);
    });

    socket.on('admin_approve_player', ({ requestId }) => {
      if (!adminAuthorized(socket)) return;
      const state = getClubState(socket.clubId);
      const idx = state.pendingApprovals.findIndex(p => p.id === requestId);
      if (idx === -1) return;

      const request = state.pendingApprovals.splice(idx, 1)[0];
      const targetSocket = io.sockets.sockets.get(request.socketId);
      if (!targetSocket?.connected || targetSocket.clubId !== socket.clubId) {
        broadcastState(socket.clubId);
        return socket.emit('error', 'This player is no longer connected.');
      }
      const sessionId = crypto.randomUUID();
      const newPlayer = {
        id: sessionId,
        currentSocketId: request.socketId,
        name: request.name,
        level: request.level,
        gender: request.gender,
        avatar: request.avatar,
        idle_rounds: 0,
        courtId: null,
        side: null,
        disconnected: false
      };
      state.players[sessionId] = newPlayer;
      if (!state.idleQueue.includes(sessionId)) state.idleQueue.push(sessionId);

      sendPlayerJoined(request.socketId, newPlayer, socket.clubId);
      broadcastState(socket.clubId);
    });

    socket.on('admin_deny_player', ({ requestId }) => {
      if (!adminAuthorized(socket)) return;
      const state = getClubState(socket.clubId);
      const idx = state.pendingApprovals.findIndex(p => p.id === requestId);
      if (idx === -1) return;

      const request = state.pendingApprovals.splice(idx, 1)[0];
      io.to(request.socketId).emit('approval_denied', { message: 'Your request to join has been denied by the admin.' });
      broadcastState(socket.clubId);
    });

    // ---- Remove Player (Admin) ----
    socket.on('admin_remove_player', ({ playerId }) => {
      if (!adminAuthorized(socket)) return;
      const state = getClubState(socket.clubId);
      const player = state.players[playerId];
      if (!player) return;

      // Notify the player before removing
      if (player.currentSocketId) {
        io.to(player.currentSocketId).emit('player_removed', { message: 'You have been removed from the session by the admin.' });
      }

      // Clean up from idle queue
      state.idleQueue = state.idleQueue.filter(id => id !== playerId);
      // Clean up from courts
      if (player.courtId) {
        const court = state.courts.find(c => c.id === player.courtId);
        if (court) {
          if (court.sideA) court.sideA = court.sideA.filter(id => id !== playerId);
          if (court.sideB) court.sideB = court.sideB.filter(id => id !== playerId);
        }
      }
      // Clean up disconnect timer
      if (state.disconnectTimers[playerId]) {
        clearTimeout(state.disconnectTimers[playerId]);
        delete state.disconnectTimers[playerId];
      }
      delete state.players[playerId];
      broadcastState(socket.clubId);
    });

    // ---- Toggle Require Approval ----
    socket.on('toggle_require_approval', (value) => {
      if (!adminAuthorized(socket)) return;
      const state = getClubState(socket.clubId);
      state.requireApproval = !!value;
      broadcastState(socket.clubId);
    });

    const leavePlayer = (id, clubId) => {
      const state = getClubState(clubId);
      const player = state.players[id];
      if (player) {
        if (state.gameStarted) return;
        state.idleQueue = state.idleQueue.filter(pid => pid !== id);
        if (player.courtId) {
          let court = state.courts.find(c => c.id === player.courtId);
          if (court) {
             if (court.sideA) court.sideA = court.sideA.filter(pid => pid !== id);
             if (court.sideB) court.sideB = court.sideB.filter(pid => pid !== id);
          }
        }
        delete state.players[id];
        broadcastState(clubId);
      }
    };

    socket.on('player_exit', () => {
      if (!socket.clubId) return;
      const state = getClubState(socket.clubId);
      if (state.gameStarted) return socket.emit('error', 'Game is in progress.');
      const sessionId = getSessionIdBySocket(socket.id, state);
      if (sessionId) leavePlayer(sessionId, socket.clubId);
    });

    const markDisconnected = (clubId) => {
      const state = getClubState(clubId);
      const previousPending = state.pendingApprovals.length;
      state.pendingApprovals = state.pendingApprovals.filter(request => request.socketId !== socket.id);
      const sessionId = getSessionIdBySocket(socket.id, state);
      if (sessionId && state.players[sessionId]) {
        state.players[sessionId].disconnected = true;
        clearTimeout(state.disconnectTimers[sessionId]);

        state.disconnectTimers[sessionId] = setTimeout(() => {
          leavePlayer(sessionId, clubId);
          delete state.disconnectTimers[sessionId];
        }, 30 * 60 * 1000);
      }
      if (sessionId || previousPending !== state.pendingApprovals.length) broadcastState(clubId);
    };

    socket.on('disconnect', () => {
      joinAttempt += 1;
      if (!socket.clubId) return;
      logger.info(`User ${socket.id} disconnected from room ${socket.clubId}`);
      markDisconnected(socket.clubId);
    });
  });

  return {
    app, server, io,
    close: () => new Promise((resolve) => {
      io.close(() => {
        Object.values(clubStates).forEach(state => Object.values(state.disconnectTimers).forEach(clearTimeout));
        resolve();
      });
    })
  };
}

module.exports = { createTennisServer };
