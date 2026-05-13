# app/ Module — Express Application

## Role

ARM64 Node.js Express server deployed inside Docker containers on ECS EC2 and ECS Fargate tasks. Provides health, info, Redis, and Aurora connectivity endpoints used by the live demo monitor.

## Key Files

| File | Purpose |
|------|---------|
| `server.js` | Main Express app — all endpoints defined here |
| `Dockerfile` | ARM64 multi-stage build (`--platform linux/arm64`); base: `node:20-alpine` |
| `test/server.test.js` | Node.js built-in `node:test` unit tests for endpoint logic |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `COLOR` | Yes | `blue` or `green` — identifies compute tier in responses |
| `VERSION` | No | Docker image tag, surfaced in `/info` response |
| `REDIS_HOST` | Yes | ElastiCache Redis primary endpoint |
| `DB_HOST` | Yes | Aurora MySQL Writer endpoint |
| `DB_USER` | Yes | Aurora database user |
| `DB_PASS` | Yes | Aurora database password (from Secrets Manager in prod) |
| `DB_NAME` | Yes | Aurora database name |
| `PORT` | No | Listen port (default: 3000) |

## Rules

- Keep `server.js` in plain CommonJS (`require`/`module.exports`) — no ESM to avoid `--experimental-vm-modules` complexity in tests.
- All endpoints must respond within 5 seconds; use `Promise.race` with timeout for Redis/DB calls.
- `/health` must return 200 even if Redis or DB is down (degraded mode).
- `/redis/hit` and `/db/ping` should return 500 with `{"error": "message"}` if connectivity fails.
- Docker image tag matches `VERSION` env var: always build with `-t bg-app:<version>`.
- Run tests with: `cd app && node --test test/server.test.js`
