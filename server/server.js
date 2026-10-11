require('dotenv').config();
const logger = require('./logger');
const { createTennisServer } = require('./app');

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  logger.error('FATAL: JWT_SECRET environment variable is not set. Create a .env file with JWT_SECRET=your_secret_key');
  process.exit(1);
}

const db = require('./db');
const application = createTennisServer({
  db,
  jwtSecret,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  logger
});
const port = process.env.PORT || 4000;
application.server.listen(port, () => logger.info(`Tennis SaaS Server running natively on multi-tenant port ${port}`));

async function shutdown() {
  await application.close();
  db.close((err) => {
    if (err) logger.error(`Database shutdown failed: ${err.message}`);
    process.exit(err ? 1 : 0);
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
