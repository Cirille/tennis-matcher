const sqlite3 = require('sqlite3');
const fs = require('node:fs');
const path = require('node:path');

async function backup(source, destination) {
  const from = path.resolve(source);
  const to = path.resolve(destination);
  if (from === to || fs.existsSync(to)) throw new Error('Choose a new backup destination; existing files are never overwritten.');
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const db = await new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(from, sqlite3.OPEN_READONLY, error => error ? reject(error) : resolve(connection));
  });
  try {
    await new Promise((resolve, reject) => db.run('VACUUM INTO ?', [to], error => error ? reject(error) : resolve()));
  } finally { await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve())); }
}
if (require.main === module) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) { console.error('Usage: node scripts/backup.js <database path> <new backup path>'); process.exitCode = 1; }
  else backup(source, destination).then(() => console.log('Consistent SQLite backup created.')).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { backup };
