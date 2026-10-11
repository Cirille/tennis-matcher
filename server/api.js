const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const { ensure, email, password, text, object, limiter } = require('./validation');

function registerApi(app, { store, jwtSecret, revokeAdmin }) {
  const readToken = token => {
    try { return jwt.verify(token, jwtSecret, { algorithms: ['HS256'] }); }
    catch { ensure(false, 'Unauthorized / Session expired', 401); }
  };
  const authenticate = async decoded => {
    ensure(decoded && Number.isInteger(decoded.id) && Number.isInteger(decoded.version), 'Unauthorized / Please sign in again', 401);
    const admin = await store.get('SELECT * FROM Admins WHERE id = ?', [decoded.id]);
    ensure(admin?.active && admin.tokenVersion === decoded.version && admin.role === decoded.role && admin.clubId === decoded.clubId && decoded.exp > Date.now() / 1000, 'Unauthorized / Session expired', 401);
    return admin;
  };
  const auth = req => authenticate(readToken(req.headers.authorization?.replace(/^Bearer /, '')));
  const owner = admin => ensure(admin.role === 'OWNER', 'Club owner access required', 403);
  const root = admin => ensure(admin.role === 'ROOT', 'Root access required', 403);
  const loginRate = limiter(15, 15 * 60 * 1000);
  const ipRate = limiter(300, 15 * 60 * 1000);
  const pinFailures = limiter(30, 10 * 60 * 1000);
  const linkRate = limiter(30, 15 * 60 * 1000);
  const hashLink = token => crypto.createHash('sha256').update(token).digest('hex');
  const createLink = async adminId => {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await store.run('DELETE FROM AccountLinks WHERE adminId = ?', [adminId]);
    await store.run('INSERT INTO AccountLinks VALUES (?, ?, ?, ?)', [hashLink(token), adminId, expiresAt, new Date().toISOString()]);
    return { token, expiresAt };
  };
  const send = handler => async (req, res) => res.json(await handler(req));

  app.post('/api/login', send(async req => {
    ensure(object(req.body) && email(req.body.email) && typeof req.body.password === 'string' && req.body.password.length > 0 && Buffer.byteLength(req.body.password) <= 72, 'Invalid credentials', 400);
    const address = req.body.email.trim().toLowerCase();
    loginRate(`${req.ip}:${address}`); ipRate(req.ip);
    const admin = await store.queue(() => store.get('SELECT * FROM Admins WHERE lower(email) = ?', [address]));
    // Always perform a password comparison, including for missing/disabled accounts.
    const valid = await bcrypt.compare(req.body.password, admin?.password_hash || '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');
    ensure(admin?.active && valid, 'Invalid email or password', 401);
    const token = jwt.sign({ id: admin.id, role: admin.role, clubId: admin.clubId, version: admin.tokenVersion }, jwtSecret, { expiresIn: '12h' });
    return { token, role: admin.role, clubId: admin.clubId };
  }));

  app.get('/api/me', send(req => store.queue(async () => {
    const admin = await auth(req);
    return { id: admin.id, email: admin.email, role: admin.role, clubId: admin.clubId };
  })));
  app.post('/api/logout', send(req => store.queue(async () => {
    const admin = await auth(req);
    await store.run('UPDATE Admins SET tokenVersion = tokenVersion + 1 WHERE id = ?', [admin.id]);
    revokeAdmin(admin.id);
    return { success: true };
  })));

  app.post('/api/root/clubs', send(async req => {
    const body = req.body;
    ensure(object(body), 'Invalid club details');
    const { clubId, clubName, pin, adminEmail, adminPassword } = body;
    ensure(typeof clubId === 'string' && /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(clubId) && !['root', 'admin', 'api', 'socket', 'socket-io', 'privacy'].includes(clubId), 'Use a lowercase club identifier of 3–50 letters, digits or hyphens');
    ensure(text(clubName, 120) && typeof pin === 'string' && /^\d{4,12}$/.test(pin) && email(adminEmail) && password(adminPassword), 'Provide a club name, 4–12 digit PIN, valid email and password of at least 12 characters (maximum 72 UTF-8 bytes)');
    await store.queue(async () => root(await auth(req)));
    const hash = await bcrypt.hash(adminPassword, 12);
    return store.queue(() => store.transaction(async () => {
      const actor = await auth(req); root(actor);
      ensure(!await store.get('SELECT id FROM Clubs WHERE id = ?', [clubId]), 'Club identifier already exists', 409);
      ensure(!await store.get('SELECT id FROM Admins WHERE lower(email) = ?', [adminEmail.trim().toLowerCase()]), 'Admin email already exists', 409);
      await store.run('INSERT INTO Clubs (id, name, pin) VALUES (?, ?, ?)', [clubId, clubName.trim(), pin]);
      await store.run('INSERT INTO Admins (email, password_hash, role, clubId) VALUES (?, ?, ?, ?)', [adminEmail.trim().toLowerCase(), hash, 'OWNER', clubId]);
      await store.audit(clubId, actor.id, 'create_club');
      return { success: true, clubId };
    }));
  }));
  app.get('/api/root/clubs', send(req => store.queue(async () => {
    root(await auth(req)); return store.all('SELECT id, name, pin FROM Clubs ORDER BY name');
  })));
  app.get('/api/clubs/:id', send(req => store.queue(async () => {
    const club = await store.get('SELECT name, mapUrl, lat, lng FROM Clubs WHERE id = ?', [req.params.id]);
    ensure(club, 'Club not found', 404); return club;
  })));
  app.post('/api/clubs/:id/verify-pin', send(req => store.queue(async () => {
    const pin = req.body?.pin;
    ensure(typeof pin === 'string' && pin.length > 0 && pin.length <= 128, 'PIN required');
    const club = await store.get('SELECT * FROM Clubs WHERE id = ?', [req.params.id]);
    ensure(club, 'Club not found', 404);
    const bucket = `${req.ip}:${club.id}:${club.pinVersion}`;
    pinFailures.check(bucket);
    if (club.pin !== pin) { pinFailures(bucket); ensure(false, 'Invalid PIN', 401); }
    const session = await store.session(club.id);
    ensure(session.status === 'open' && session.checkInOpen, 'Check-in is closed', 409);
    return { success: true, joinToken: jwt.sign({ role: 'PLAYER_JOIN', clubId: club.id, session: session.id, pinVersion: club.pinVersion }, jwtSecret, { expiresIn: '30m' }) };
  })));

  app.get('/api/staff', send(req => store.queue(async () => {
    const admin = await auth(req); owner(admin);
    return { staff: await store.all('SELECT id, email, role, active FROM Admins WHERE clubId = ? ORDER BY id', [admin.clubId]) };
  })));
  app.post('/api/staff/invite', send(req => store.queue(() => store.transaction(async () => {
    const actor = await auth(req); owner(actor);
    ensure(object(req.body) && email(req.body.email) && ['ADMIN', 'OWNER'].includes(req.body.role), 'Provide an email and staff role');
    const address = req.body.email.trim().toLowerCase();
    ensure(!await store.get('SELECT id FROM Admins WHERE lower(email) = ?', [address]), 'This email already has an account. Use its reset link or a different email.', 409);
    const count = await store.get('SELECT COUNT(*) AS total FROM Admins WHERE clubId = ?', [actor.clubId]);
    ensure(count.total < 50, 'Maximum 50 staff accounts per club');
    const result = await store.run('INSERT INTO Admins (email, role, clubId, active) VALUES (?, ?, ?, 0)', [address, req.body.role, actor.clubId]);
    const link = await createLink(result.id);
    await store.audit(actor.clubId, actor.id, 'invite_staff', String(result.id));
    return { success: true, ...link };
  }))));
  app.patch('/api/staff/:id', send(req => store.queue(async () => {
    const targetId = Number(req.params.id);
    await store.transaction(async () => {
      const actor = await auth(req); owner(actor);
      ensure(object(req.body) && ['ADMIN', 'OWNER'].includes(req.body.role) && typeof req.body.active === 'boolean', 'Invalid staff settings');
      const target = await store.get('SELECT * FROM Admins WHERE id = ? AND clubId = ?', [targetId, actor.clubId]);
      ensure(target, 'Staff account not found', 404);
      ensure(!req.body.active || target.password_hash, 'Account must accept an invitation before activation');
      if (target.role === 'OWNER' && target.active && (req.body.role !== 'OWNER' || !req.body.active)) {
        const remaining = await store.get("SELECT COUNT(*) AS count FROM Admins WHERE clubId = ? AND role = 'OWNER' AND active = 1 AND id != ?", [actor.clubId, targetId]);
        ensure(remaining.count > 0, 'A club must retain at least one active owner', 409);
      }
      await store.run('UPDATE Admins SET role = ?, active = ?, tokenVersion = tokenVersion + 1 WHERE id = ?', [req.body.role, Number(req.body.active), targetId]);
      await store.run('DELETE FROM AccountLinks WHERE adminId = ?', [targetId]);
      await store.audit(actor.clubId, actor.id, 'update_staff', String(targetId));
    });
    revokeAdmin(targetId); return { success: true };
  })));
  app.post('/api/staff/:id/reset-link', send(req => store.queue(() => store.transaction(async () => {
    const actor = await auth(req); owner(actor);
    const target = await store.get('SELECT id FROM Admins WHERE id = ? AND clubId = ?', [Number(req.params.id), actor.clubId]);
    ensure(target, 'Staff account not found', 404);
    const link = await createLink(target.id);
    await store.audit(actor.clubId, actor.id, 'staff_reset_link', String(target.id));
    return { success: true, ...link };
  }))));
  app.post('/api/root/clubs/:id/recovery-link', send(req => store.queue(() => store.transaction(async () => {
    const actor = await auth(req); root(actor);
    const target = await store.get("SELECT id FROM Admins WHERE clubId = ? AND role = 'OWNER' ORDER BY active DESC, id LIMIT 1", [req.params.id]);
    ensure(target, 'Club owner not found', 404);
    const link = await createLink(target.id);
    await store.audit(req.params.id, actor.id, 'owner_recovery_link', String(target.id));
    return { success: true, ...link };
  }))));
  app.post('/api/account/accept', send(async req => {
    linkRate(req.ip);
    ensure(object(req.body) && typeof req.body.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(req.body.token) && password(req.body.password), 'A valid link and password of at least 12 characters (maximum 72 UTF-8 bytes) are required');
    const hash = hashLink(req.body.token);
    await store.queue(async () => ensure(await store.get('SELECT hash FROM AccountLinks WHERE hash = ? AND expiresAt > ?', [hash, new Date().toISOString()]), 'Link expired or already used', 400));
    const passwordHash = await bcrypt.hash(req.body.password, 12);
    return store.queue(async () => {
      let target;
      await store.transaction(async () => {
        const link = await store.get('SELECT * FROM AccountLinks WHERE hash = ? AND expiresAt > ?', [hash, new Date().toISOString()]);
        ensure(link, 'Link expired or already used');
        target = await store.get('SELECT * FROM Admins WHERE id = ?', [link.adminId]);
        await store.run('UPDATE Admins SET password_hash = ?, active = 1, tokenVersion = tokenVersion + 1 WHERE id = ?', [passwordHash, target.id]);
        await store.run('DELETE FROM AccountLinks WHERE adminId = ?', [target.id]);
        await store.audit(target.clubId, target.id, 'accept_account_link');
      });
      revokeAdmin(target.id); return { success: true };
    });
  }));
  app.get('/api/audit', send(req => store.queue(async () => {
    const admin = await auth(req); owner(admin);
    return { entries: await store.all('SELECT a.id, a.action, a.targetId, a.createdAt, u.email AS actor FROM AuditLog a LEFT JOIN Admins u ON u.id = a.actorId WHERE a.clubId = ? ORDER BY a.id DESC LIMIT 100', [admin.clubId]) };
  })));
  app.get('/api/sessions', send(req => store.queue(async () => {
    const admin = await auth(req); ensure(['OWNER', 'ADMIN'].includes(admin.role), 'Club access required', 403);
    return { sessions: await store.all('SELECT id, status, createdAt, endedAt FROM Sessions WHERE clubId = ? ORDER BY createdAt DESC LIMIT 100', [admin.clubId]) };
  })));
  app.get('/api/sessions/:id', send(req => store.queue(async () => {
    const admin = await auth(req); ensure(['OWNER', 'ADMIN'].includes(admin.role), 'Club access required', 403);
    const row = await store.get('SELECT data FROM Sessions WHERE id = ? AND clubId = ?', [req.params.id, admin.clubId]);
    ensure(row, 'Session not found', 404);
    const session = JSON.parse(row.data);
    return { sessionId: session.id, createdAt: session.createdAt, matchHistory: session.matchHistory };
  })));
  app.delete('/api/sessions/:id', send(req => store.queue(async () => {
    const admin = await auth(req); owner(admin);
    const current = await store.session(admin.clubId);
    ensure(current.id !== req.params.id, 'Start a new session before deleting the previous session', 409);
    await store.transaction(async () => {
      const result = await store.run("DELETE FROM Sessions WHERE id = ? AND clubId = ? AND status = 'ended'", [req.params.id, admin.clubId]);
      ensure(result.changes === 1, 'Archived session not found', 404);
      await store.audit(admin.clubId, admin.id, 'delete_archive', req.params.id);
    });
    return { success: true };
  })));
  return { authenticate, readToken };
}
module.exports = { registerApi };
