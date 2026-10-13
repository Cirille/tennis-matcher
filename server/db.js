const sqlite3 = require('sqlite3');
const path = require('node:path');
const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const { password, email } = require('./validation');

function openDatabase(filename = process.env.DATABASE_PATH || path.join(__dirname, 'database.sqlite')) {
  const resolved = path.resolve(filename);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(resolved, error => error ? reject(error) : resolve(db));
  });
}

async function seedRoot(store, rootEmail, rootPassword) {
  const root = await store.get("SELECT id FROM Admins WHERE role = 'ROOT' LIMIT 1");
  if (root) return;
  if (!email(rootEmail) || !password(rootPassword) || rootPassword.startsWith('replace_')) throw new Error('Initial ROOT_EMAIL and ROOT_PASSWORD (at least 12 characters, maximum 72 UTF-8 bytes) are required.');
  const hash = await bcrypt.hash(rootPassword, 12);
  await store.run('INSERT INTO Admins (email, password_hash, role) VALUES (?, ?, ?)', [rootEmail.toLowerCase(), hash, 'ROOT']);
}
module.exports = { openDatabase, seedRoot };
