// Local visual smoke-test fixture. No .env or runtime database is opened.
const sqlite3 = require('sqlite3');
const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { createTennisServer } = require('../app');
const { addPlayer, applyCommand } = require('../session');

async function main() {
  const db = new sqlite3.Database(':memory:');
  const port = 4179;
  const app = createTennisServer({ db, jwtSecret: crypto.randomBytes(48).toString('hex'), corsOrigin: `http://127.0.0.1:${port}` });
  await app.ready;
  await app.store.queue(async () => {
    await app.store.run("INSERT INTO Clubs (id, name, pin) VALUES ('demo-club', 'Riverside Tennis Club', '1234')");
    const hash = await bcrypt.hash('demo-password-123', 4);
    await app.store.run("INSERT INTO Admins (email, password_hash, role, clubId) VALUES ('owner@example.test', ?, 'OWNER', 'demo-club')", [hash]);
    const state = await app.store.session('demo-club');
    for (const name of ['Alex', 'Robin', 'Sam', 'Jamie', 'Morgan', 'Taylor', 'Charlie', 'Jordan', 'Casey', 'Riley']) addPlayer(state, { name, level: 5, gender: 'Other' }, null);
    applyCommand(state, 'add_court', { type: 'Hard' }); applyCommand(state, 'add_court', { type: 'Clay' }); applyCommand(state, 'auto_matchmake');
    await app.store.save(state);
  });
  const dist = path.resolve(__dirname, '../../client/dist');
  app.app.use(express.static(dist));
  app.app.get('/{*path}', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  app.server.listen(port, '127.0.0.1', () => console.log(`Synthetic demo: http://127.0.0.1:${port}/admin | owner@example.test | demo-password-123 | Player PIN: 1234`));
  const shutdown = async () => { await app.close(); db.close(); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
main().catch(error => { console.error(error.message); process.exit(1); });
