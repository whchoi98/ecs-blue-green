const express = require('express');
const os = require('node:os');
const Redis = require('ioredis');
const mysql = require('mysql2/promise');

const COLOR = process.env.COLOR ?? 'blue';
const COMPUTE_TYPE = process.env.COMPUTE_TYPE ?? 'unknown';
const REDIS_URL = process.env.REDIS_URL ?? '';
const DB_HOST = process.env.DB_HOST ?? '';
const DB_USER = process.env.DB_USER ?? 'admin';
const DB_PASSWORD = process.env.DB_PASSWORD ?? '';
const DB_NAME = process.env.DB_NAME ?? 'bgtest';
const SKIP_DEPS = process.env.SKIP_DEPS === '1';

let redis = null;
let dbPool = null;

if (!SKIP_DEPS) {
  if (REDIS_URL) {
    redis = new Redis(REDIS_URL, { tls: REDIS_URL.startsWith('rediss://') ? {} : undefined, lazyConnect: true });
    redis.connect().catch((e) => console.error('redis connect:', e.message));
  }
  if (DB_HOST) {
    dbPool = mysql.createPool({ host: DB_HOST, user: DB_USER, password: DB_PASSWORD, database: DB_NAME, connectionLimit: 5 });
  }
}

function createApp() {
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy', color: COLOR, compute: COMPUTE_TYPE });
  });

  app.get('/info', async (_req, res) => {
    let redisHits = null;
    let dbPingMs = null;
    try { if (redis) redisHits = Number(await redis.get(`visits:${COLOR}`)) || 0; } catch (_) {}
    try {
      if (dbPool) {
        const t0 = Date.now();
        await dbPool.query('SELECT 1');
        dbPingMs = Date.now() - t0;
      }
    } catch (_) {}
    res.json({
      color: COLOR, compute: COMPUTE_TYPE,
      hostname: os.hostname(), redisHits, dbPingMs,
    });
  });

  app.get('/redis/hit', async (_req, res) => {
    try {
      if (!redis) return res.status(503).json({ error: 'redis unavailable' });
      const v = await redis.incr(`visits:${COLOR}`);
      res.json({ visits: v, color: COLOR });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/db/ping', async (_req, res) => {
    try {
      if (!dbPool) return res.status(503).json({ error: 'db unavailable' });
      const [rows] = await dbPool.query('SELECT NOW() AS t, @@hostname AS h');
      res.json({ rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/', (_req, res) => {
    const bg = COLOR === 'green' ? '#43a047' : '#1e88e5';
    const label = COLOR.toUpperCase();
    res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>${label} - ${COMPUTE_TYPE}</title>
<style>
body { margin:0; font-family:system-ui,sans-serif; background:${bg}; color:#fff; min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; }
h1 { font-size:8rem; margin:0; letter-spacing:.1em; }
.meta { margin-top:2rem; font-size:1.2rem; opacity:.9; }
.meta div { margin:.3rem 0; }
</style></head>
<body>
<h1>${label}</h1>
<div class="meta">
  <div>compute: <strong>${COMPUTE_TYPE}</strong></div>
  <div>host: <span id="host">…</span></div>
  <div>redis hits: <span id="hits">…</span></div>
  <div>db ping: <span id="db">…</span> ms</div>
</div>
<script>
fetch('/info').then(r=>r.json()).then(j=>{
  document.getElementById('host').textContent = j.hostname;
  document.getElementById('hits').textContent = j.redisHits ?? 'n/a';
  document.getElementById('db').textContent = j.dbPingMs ?? 'n/a';
});
</script>
</body></html>`);
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`[${COLOR}/${COMPUTE_TYPE}] listening on :${port}`));
}

module.exports = { createApp };
