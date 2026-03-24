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

    // Seed Root Account if empty
    db.get("SELECT count(*) as count FROM Admins", (err, row) => {
      if (err) console.error(err);
      if (row && row.count === 0) {
        const bcrypt = require('bcryptjs');
        const hash = bcrypt.hashSync('root', 10);
        db.run(`INSERT INTO Admins (email, password_hash, role, clubId) VALUES (?, ?, ?, ?)`, 
          ['root@tennis.com', hash, 'ROOT', null]);
        console.log("Seeded default ROOT account. email: root@tennis.com, pass: root");
      }
    });

    // Seed Demo Club & Admin if empty (just for seamless testing right now without Root setup)
    db.get("SELECT count(*) as count FROM Clubs", (err, row) => {
      if (err) console.error(err);
      if (row && row.count === 0) {
        const bcrypt = require('bcryptjs');
        const hash = bcrypt.hashSync('admin', 10);
        db.run(`INSERT INTO Clubs (id, name, pin) VALUES (?, ?, ?)`, 
          ['demo-club', 'Demo Tennis Club', '1234']);
        db.run(`INSERT INTO Admins (email, password_hash, role, clubId) VALUES (?, ?, ?, ?)`, 
          ['admin@demo.com', hash, 'ADMIN', 'demo-club']);
        console.log("Seeded Demo Club (ID: demo-club, PIN: 1234). Admin: admin@demo.com, pass: admin");
      }
    });
  });
};

initDB();

module.exports = db;
