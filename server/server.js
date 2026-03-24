const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const { autoMatchmake } = require('./matchmaker');
const db = require('./db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_tennis_key_2026';

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
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN required' });
  db.get("SELECT pin FROM Clubs WHERE id = ?", [req.params.id], (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'Club not found' });
    if (row.pin === pin) res.json({ success: true });
    else res.status(401).json({ error: 'Invalid PIN' });
  });
});

// ----------------------------------------
// SOCKET.IO MULTI-TENANT SERVER
// ----------------------------------------
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const clubStates = {};

const getClubState = (clubId) => {
  if (!clubStates[clubId]) {
    clubStates[clubId] = {
      clubName: 'Loading...', 
      gameStarted: false,
      clubMapUrl: null, clubLat: null, clubLng: null,
      courts: [], players: {}, idleQueue: [],
      disconnectTimers: {}, idleAtStart: new Set(), matchHistory: []
    };
    // Fetch initial config from DB
    db.get("SELECT name, mapUrl, lat, lng FROM Clubs WHERE id = ?", [clubId], (err, row) => {
      if (row) {
        clubStates[clubId].clubName = row.name;
        clubStates[clubId].clubMapUrl = row.mapUrl;
        clubStates[clubId].clubLat = row.lat;
        clubStates[clubId].clubLng = row.lng;
      }
    });
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
    matchHistory: state.matchHistory
  };
  if (emitToId) {
    io.to(emitToId).emit('state_update', payload);
  } else {
    io.to(clubId).emit('state_update', payload);
  }
};

// Map extractors
const extractLatLng = (urlStr) => {
  const regex = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
  const match = urlStr.match(regex);
  if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
  return null;
};
const resolveMapLink = async (urlStr) => {
  try {
    const directCoords = extractLatLng(urlStr);
    if (directCoords) return directCoords;
    return new Promise((resolve) => {
      const reqModule = urlStr.startsWith('https') ? https : http;
      reqModule.get(urlStr, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const loc = res.headers.location;
          const coords = extractLatLng(loc);
          if (coords) return resolve(coords);
        }
        resolve(null);
      }).on('error', () => resolve(null));
    });
  } catch (e) { return null; }
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
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // 1. Join isolated Room
  socket.on('join_club_room', ({ clubId, role, token }) => {
    if (!clubId) return socket.emit('error', 'Club ID missing');

    const initializeSocket = (isAdmin) => {
      socket.join(clubId);
      socket.clubId = clubId;
      socket.isAdmin = isAdmin;
      getClubState(clubId); // Boot state into memory if empty
      broadcastState(clubId, socket.id); // Send initial state instantly precisely to this connecting socket
    };

    if (role === 'ADMIN') {
      jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err || decoded.clubId !== clubId) return socket.emit('error', 'Unauthorized Admin / Session Expired');
        initializeSocket(true);
      });
    } else {
      initializeSocket(false);
    }
  });

  const generateAvatar = (name) => `https://api.dicebear.com/7.x/pixel-art/svg?seed=${encodeURIComponent(name + Date.now())}`;
  
  const getSessionIdBySocket = (socketId, state) => {
    for (const [sId, p] of Object.entries(state.players)) {
      if (p.currentSocketId === socketId) return sId;
    }
    return null;
  };

  // 2. Play Actions
  socket.on('join_player', (data) => {
    if (!socket.clubId) return socket.emit('error', 'Must join a Club Room first (Internal routing error)');
    const state = getClubState(socket.clubId);

    if (data.sessionId) {
      if (state.players[data.sessionId]) {
        const player = state.players[data.sessionId];
        player.currentSocketId = socket.id;
        player.disconnected = false;
        if (state.disconnectTimers[data.sessionId]) {
          clearTimeout(state.disconnectTimers[data.sessionId]);
          delete state.disconnectTimers[data.sessionId];
        }
        socket.emit('player_joined', player);
        broadcastState(socket.clubId);
        return;
      } else {
        socket.emit('error', 'Session expired. Please join again.');
        return;
      }
    }

    const existingSession = getSessionIdBySocket(socket.id, state);
    if (existingSession && state.players[existingSession]) {
      socket.emit('player_joined', state.players[existingSession]);
      return;
    }

    if (state.clubLat && state.clubLng && data.lat && data.lng) {
      const dist = getDistanceFromLatLonInKm(state.clubLat, state.clubLng, data.lat, data.lng);
      if (dist > 2.0) {
        socket.emit('error', 'GPS validation failed. You are too far from the club.');
        return;
      }
    }
    
    const sessionId = crypto.randomUUID();
    const newPlayer = {
      id: sessionId,
      currentSocketId: socket.id,
      name: data.name,
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
    
    socket.emit('player_joined', newPlayer);
    broadcastState(socket.clubId);
  });

  // Admin Config Actions
  socket.on('update_courts', (newCourts) => {
    if (!socket.isAdmin || !socket.clubId) return;
    getClubState(socket.clubId).courts = newCourts;
    broadcastState(socket.clubId);
  });

  socket.on('update_club_location', async (urlStr) => {
    if (!socket.isAdmin || !socket.clubId) return;
    const state = getClubState(socket.clubId);
    state.clubMapUrl = urlStr;
    if (!urlStr || !urlStr.trim()) {
      state.clubLat = null; state.clubLng = null;
    } else {
      const coords = await resolveMapLink(urlStr);
      if (coords) {
        state.clubLat = coords.lat; state.clubLng = coords.lng;
        // Save to DB persistently
        db.run("UPDATE Clubs SET mapUrl=?, lat=?, lng=? WHERE id=?", [urlStr, coords.lat, coords.lng, socket.clubId]);
      } else {
        socket.emit('error', 'Could not extract valid GPS coordinates from the provided map link.');
        state.clubLat = null; state.clubLng = null;
      }
    }
    broadcastState(socket.clubId);
  });

  socket.on('toggle_game', (started) => {
    if (!socket.isAdmin || !socket.clubId) return;
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
    if (!socket.isAdmin || !socket.clubId) return;
    const state = getClubState(socket.clubId);
    state.idleQueue = autoMatchmake(state.courts, state.players, state.idleQueue, state.matchHistory);
    broadcastState(socket.clubId);
  });

  socket.on('admin_move_player', ({ playerId, sourceCourtId, sourceSide, destCourtId, destSide }) => {
    if (!socket.isAdmin || !socket.clubId) return;
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

  socket.on('disconnect', () => {
    if (!socket.clubId) return; // user dropped before securely joining a room
    console.log(`User ${socket.id} disconnected from room ${socket.clubId}`);
    const state = getClubState(socket.clubId);
    const sessionId = getSessionIdBySocket(socket.id, state);
    if (sessionId && state.players[sessionId]) {
      state.players[sessionId].disconnected = true;
      broadcastState(socket.clubId);
      
      state.disconnectTimers[sessionId] = setTimeout(() => {
        leavePlayer(sessionId, socket.clubId);
        delete state.disconnectTimers[sessionId];
      }, 30 * 60 * 1000);
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Tennis SaaS Server running natively on multi-tenant port ${PORT}`));
