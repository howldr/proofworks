/**
 * howldr ProofWorks
 * Express app factory
 *
 * Builds the app without binding a port or touching the scheduler, so tests
 * can drive it with supertest and src/index.js stays a thin runner.
 */

const express = require('express');
const db      = require('./db/db');
const api     = require('./api/index');
const { tenantResolver } = require('./middleware/tenant');
const { authResolver   } = require('./middleware/auth');

/**
 * CORS for the static SPA (Cloudflare Pages) calling this API cross-origin.
 *
 * Auth is a Bearer header, never cookies, so reflecting the origin without
 * credentials is safe. Set CORS_ORIGINS to a comma-separated allowlist to
 * restrict; unset, any origin may call (the JWT still gates every route
 * that matters).
 */
function corsMiddleware() {
  const allowlist = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      const allowed = allowlist.length === 0 || allowlist.includes(origin.toLowerCase());
      if (allowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Max-Age', '86400');
      }
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  };
}

function createApp() {
  const app = express();

  // Behind Railway's load balancer — respect X-Forwarded-* headers.
  app.set('trust proxy', true);

  app.use(corsMiddleware());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logging (quiet in tests)
  if (process.env.NODE_ENV !== 'test') {
    app.use((req, res, next) => {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
      next();
    });
  }

  // Tenant resolution runs before routing so /t/{slug}/... gets rewritten in time.
  app.use(tenantResolver());

  // Auth resolution: silently attaches req.user when a valid JWT is provided.
  // Routes that need a user must gate themselves with requireUser().
  app.use(authResolver());

  app.use('/api', api);

  app.get('/health', async (req, res) => {
    try {
      const db_time = await db.healthCheck();
      res.json({ status: 'ok', db: db_time });
    } catch (err) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.get('/', (req, res) => {
    res.json({
      name:    'howldr ProofWorks',
      version: '0.1.0',
      url:     'https://howldr.com',
    });
  });

  return app;
}

module.exports = { createApp, corsMiddleware };
