require('dotenv').config();
const logger = require('./logger');
const { createTennisServer } = require('./app');
const { openDatabase, seedRoot } = require('./db');

async function start() {
  const jwtSecret = process.env.JWT_SECRET;
  const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
  if (!jwtSecret || jwtSecret === 'your_secret_key_here' || jwtSecret.startsWith('replace_')) throw new Error('Set JWT_SECRET to a random secret.');
  if (process.env.NODE_ENV === 'production' && (jwtSecret.length < 32 || !corsOrigin.startsWith('https://'))) throw new Error('Production requires a JWT_SECRET of at least 32 characters and an HTTPS CORS_ORIGIN.');
  const origin = new URL(corsOrigin);
  if (origin.origin !== corsOrigin) throw new Error('CORS_ORIGIN must be an exact origin with no trailing slash.');
  const db = await openDatabase();
  const application = createTennisServer({ db, jwtSecret, corsOrigin, logger, trustProxy: process.env.TRUST_PROXY === 'loopback' ? 'loopback' : false });
  await application.ready;
  await seedRoot(application.store, process.env.ROOT_EMAIL || 'root@tennis.com', process.env.ROOT_PASSWORD);
  const port = Number(process.env.PORT || 4000);
  const host = process.env.HOST || '127.0.0.1';
  application.server.listen(port, host, () => logger.info(`Tennis server listening on ${host}:${port}`));
  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10000).unref();
    try {
      await application.close();
      await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
      clearTimeout(deadline);
    } catch (error) { logger.error(error.message); process.exitCode = 1; }
  }
  application.server.on('error', error => { logger.error(error.message); shutdown(); process.exitCode = 1; });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
start().catch(error => { logger.error(`Startup failed: ${error.message}`); process.exit(1); });
