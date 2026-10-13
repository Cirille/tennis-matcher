const crypto = require('node:crypto');

const run = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (error) { error ? reject(error) : resolve({ id: this.lastID, changes: this.changes }); });
});
const get = (db, sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
const all = (db, sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));

async function migrate(db) {
  await run(db, 'PRAGMA busy_timeout = 5000');
  await run(db, 'PRAGMA foreign_keys = ON');
  await run(db, 'PRAGMA journal_mode = WAL');
  await run(db, `CREATE TABLE IF NOT EXISTS Clubs (id TEXT PRIMARY KEY, name TEXT, pin TEXT, mapUrl TEXT, lat REAL, lng REAL)`);
  await run(db, `CREATE TABLE IF NOT EXISTS Admins (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, password_hash TEXT, role TEXT, clubId TEXT)`);
  const columns = await all(db, 'PRAGMA table_info(Admins)');
  if (!columns.some(c => c.name === 'tokenVersion')) {
    await run(db, 'BEGIN IMMEDIATE');
    try {
      await run(db, 'ALTER TABLE Admins ADD COLUMN tokenVersion INTEGER NOT NULL DEFAULT 0');
      await run(db, 'ALTER TABLE Admins ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
      // Upgrade the first existing club account to owner once, without reseeding accounts.
      await run(db, `UPDATE Admins SET role = 'OWNER' WHERE id IN (SELECT MIN(id) FROM Admins WHERE role = 'ADMIN' AND clubId IS NOT NULL GROUP BY clubId)`);
      await run(db, 'COMMIT');
    } catch (error) { await run(db, 'ROLLBACK'); throw error; }
  }
  const clubColumns = await all(db, 'PRAGMA table_info(Clubs)');
  if (!clubColumns.some(c => c.name === 'pinVersion')) await run(db, 'ALTER TABLE Clubs ADD COLUMN pinVersion INTEGER NOT NULL DEFAULT 0');
  if (!clubColumns.some(c => c.name === 'requireApproval')) await run(db, 'ALTER TABLE Clubs ADD COLUMN requireApproval INTEGER NOT NULL DEFAULT 0');
  await run(db, 'CREATE UNIQUE INDEX IF NOT EXISTS normalized_admin_email ON Admins(lower(email))');
  await run(db, `CREATE TABLE IF NOT EXISTS Sessions (
    id TEXT PRIMARY KEY, clubId TEXT NOT NULL REFERENCES Clubs(id), status TEXT NOT NULL,
    createdAt TEXT NOT NULL, endedAt TEXT, revision INTEGER NOT NULL, data TEXT NOT NULL)`);
  await run(db, `CREATE UNIQUE INDEX IF NOT EXISTS one_open_session ON Sessions(clubId) WHERE status = 'open'`);
  await run(db, 'CREATE INDEX IF NOT EXISTS sessions_by_club ON Sessions(clubId, createdAt)');
  await run(db, `CREATE TABLE IF NOT EXISTS CommandReceipts (
    clubId TEXT NOT NULL, adminId INTEGER NOT NULL, commandId TEXT NOT NULL, fingerprint TEXT NOT NULL,
    result TEXT NOT NULL, createdAt TEXT NOT NULL, PRIMARY KEY(clubId, adminId, commandId))`);
  await run(db, `CREATE TABLE IF NOT EXISTS AuditLog (
    id INTEGER PRIMARY KEY AUTOINCREMENT, clubId TEXT, actorId INTEGER, action TEXT NOT NULL,
    targetId TEXT, createdAt TEXT NOT NULL)`);
  await run(db, `CREATE TABLE IF NOT EXISTS AccountLinks (
    hash TEXT PRIMARY KEY, adminId INTEGER NOT NULL REFERENCES Admins(id), expiresAt TEXT NOT NULL, createdAt TEXT NOT NULL)`);
  await run(db, `CREATE TABLE IF NOT EXISTS SchemaVersion (version INTEGER PRIMARY KEY)`);
  await run(db, 'INSERT OR IGNORE INTO SchemaVersion VALUES (1)');
}

function newSession(clubId, previous = {}) {
  return {
    id: crypto.randomUUID(), clubId, createdAt: new Date().toISOString(), endedAt: null,
    status: 'open', revision: 0, checkInOpen: true, gameStarted: false,
    courts: (previous.courts || []).map(c => ({ ...c, sideA: [], sideB: [] })),
    players: {}, idleQueue: [], idleAtStart: [], matchHistory: [], pendingApprovals: [],
    requireApproval: previous.requireApproval ?? false, roundId: null
  };
}

function createStore(db) {
  let tail = migrate(db);
  const ready = tail;
  const states = new Map();
  const queue = fn => {
    const result = tail.then(fn);
    tail = result.catch(() => {});
    return result;
  };
  const transaction = async fn => {
    await run(db, 'BEGIN IMMEDIATE');
    try {
      const result = await fn();
      await run(db, 'COMMIT');
      return result;
    } catch (error) { await run(db, 'ROLLBACK'); throw error; }
  };
  const save = async state => {
    const durable = structuredClone(state);
    // Socket identifiers and unapproved applications are transient, never restored.
    durable.pendingApprovals = [];
    for (const player of Object.values(durable.players)) {
      delete player.currentSocketId;
      player.disconnected = true;
    }
    await run(db, `INSERT INTO Sessions (id, clubId, status, createdAt, endedAt, revision, data)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,
      endedAt=excluded.endedAt, revision=excluded.revision, data=excluded.data`,
    [state.id, state.clubId, state.status, state.createdAt, state.endedAt, state.revision, JSON.stringify(durable)]);
  };
  const session = async clubId => {
    if (states.has(clubId)) return states.get(clubId);
    const row = await get(db, 'SELECT data FROM Sessions WHERE clubId = ? ORDER BY createdAt DESC, rowid DESC LIMIT 1', [clubId]);
    const club = await get(db, 'SELECT requireApproval FROM Clubs WHERE id = ?', [clubId]);
    const state = row ? JSON.parse(row.data) : newSession(clubId, { requireApproval: Boolean(club?.requireApproval) });
    if (!row) await save(state);
    states.set(clubId, state);
    return state;
  };
  const audit = (clubId, actorId, action, targetId = null) => run(db,
    'INSERT INTO AuditLog (clubId, actorId, action, targetId, createdAt) VALUES (?, ?, ?, ?, ?)',
    [clubId, actorId, action, targetId, new Date().toISOString()]);
  const prune = async () => {
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
    await transaction(async () => {
      const expired = await all(db, "SELECT id, clubId, data FROM Sessions WHERE status = 'ended' AND endedAt < ?", [cutoff]);
      for (const row of expired) {
        const latest = await get(db, 'SELECT id FROM Sessions WHERE clubId = ? ORDER BY createdAt DESC, rowid DESC LIMIT 1', [row.clubId]);
        if (latest.id !== row.id) await run(db, 'DELETE FROM Sessions WHERE id = ?', [row.id]);
        else {
          const state = JSON.parse(row.data);
          Object.assign(state, { players: {}, idleQueue: [], idleAtStart: [], matchHistory: [], pendingApprovals: [], courts: state.courts.map(c => ({ ...c, sideA: [], sideB: [] })) });
          await save(state);
        }
      }
      await run(db, 'DELETE FROM AuditLog WHERE createdAt < ?', [cutoff]);
      await run(db, 'DELETE FROM AccountLinks WHERE expiresAt < ?', [new Date().toISOString()]);
      await run(db, 'DELETE FROM CommandReceipts WHERE createdAt < ?', [new Date(Date.now() - 7 * 86400000).toISOString()]);
    });
    // Evict ended cached states so reads reflect retention cleanup.
    for (const [clubId, state] of states) if (state.status === 'ended' && state.endedAt < cutoff) states.delete(clubId);
  };
  return { db, ready, queue, transaction, session, save, states, audit, prune,
    run: (sql, params) => run(db, sql, params), get: (sql, params) => get(db, sql, params), all: (sql, params) => all(db, sql, params),
    drain: () => tail };
}

module.exports = { createStore, migrate, newSession, run, get, all };
