const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

const initDB = () => {
  db.serialize(() => {
    // Admins table (Root creates Admins)
    db.run(`
      CREATE TABLE IF NOT EXISTS Admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        password_hash TEXT,
        role TEXT,
        clubId TEXT
      )
    `);

    // Clubs table (contains PIN for players to join)
    db.run(`
      CREATE TABLE IF NOT EXISTS Clubs (
        id TEXT PRIMARY KEY,
        name TEXT,
        pin TEXT,
        mapUrl TEXT,
        lat REAL,
        lng REAL
      )
    `);

    // Seed Root Account if no admins exist
    db.get("SELECT count(*) as count FROM Admins", (err, row) => {
      if (err) console.error(err);
      if (row && row.count === 0) {
        const bcrypt = require('bcryptjs');
        const rootEmail = process.env.ROOT_EMAIL || 'root@tennis.com';
        const rootPassword = process.env.ROOT_PASSWORD;
        if (!rootPassword) {
          console.error('FATAL: ROOT_PASSWORD environment variable is not set. Needed for initial root account seed.');
          process.exit(1);
        }
        const hash = bcrypt.hashSync(rootPassword, 10);
        db.run(`INSERT INTO Admins (email, password_hash, role, clubId) VALUES (?, ?, ?, ?)`, 
          [rootEmail, hash, 'ROOT', null]);
        console.log(`Seeded ROOT account. Email: ${rootEmail}. Use the Root Dashboard to create clubs.`);
      }
    });
  });
};

initDB();

module.exports = db;
