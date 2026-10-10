/**
 * howldr ProofWorks
 * Application entry point — thin runner around src/app.js
 */

require('dotenv').config();

const db = require('./db/db');
const { createApp }      = require('./app');
const { startScheduler } = require('./scheduler/scheduler');

const PORT = process.env.PORT || 3000;

async function start() {
  // Verify database connection before accepting traffic
  try {
    await db.healthCheck();
    console.log('[app] Database connection verified');
  } catch (err) {
    console.error('[app] Database connection failed — check DATABASE_URL:', err.message);
    process.exit(1);
  }

  const app = createApp();
  app.listen(PORT, () => {
    console.log(`[app] ProofWorks running on port ${PORT}`);
    console.log(`[app] Environment: ${process.env.NODE_ENV || 'development'}`);
  });

  // Start the review/reminder scheduler
  if (process.env.NODE_ENV !== 'test') {
    startScheduler();
  }
}

start();
