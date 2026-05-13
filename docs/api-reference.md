# API Reference

The `bg-app` Express application serves on port 3000 inside ARM64 Docker containers. It is reached via CloudFront -> ALB -> ECS/EC2 in production. Direct access is blocked by CloudFront prefix-list ALB security group rules.

## Base URL

| Environment | URL |
|-------------|-----|
| CloudFront (Blue/Green) | CloudFront distribution URL (see `BgTestCfStack` CfnOutput) |
| CloudFront (Rolling) | Rolling CloudFront distribution URL (see `BgTestRollingCfStack` CfnOutput) |
| ALB direct (dev) | ALB DNS name (see `BgTestAlbStack` CfnOutput — blocked from internet) |

## Authentication

No authentication required. Internal requests validated by `X-Custom-Secret` header injected by CloudFront (ALB validates the header value; requests without it are rejected at the SG level).

## Endpoints

### Health Check

```
GET /health
```

Returns service health status.

**Response** `200 OK`

```json
{
  "status": "healthy",
  "color": "blue"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Always `"healthy"` if process is running |
| `color` | string | Value of `COLOR` env var (`"blue"` or `"green"`) |

---

### Service Info

```
GET /info
```

Returns runtime metadata for identifying the serving instance.

**Response** `200 OK`

```json
{
  "color": "blue",
  "version": "v1",
  "hostname": "ip-10-1-2-123.ap-northeast-2.compute.internal",
  "region": "ap-northeast-2",
  "az": "ap-northeast-2a"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `color` | string | `COLOR` env var |
| `version` | string | `VERSION` env var (Docker image tag) |
| `hostname` | string | EC2 instance hostname |
| `region` | string | AWS region |
| `az` | string | Availability zone |

---

### Redis Hit Counter

```
GET /redis/hit
```

Increments a Redis counter and returns the current count. Used by the live monitor to demonstrate Redis connectivity.

**Response** `200 OK`

```json
{
  "color": "blue",
  "redis": "connected",
  "hits": 42
}
```

| Field | Type | Description |
|-------|------|-------------|
| `color` | string | Serving tier color |
| `redis` | string | `"connected"` or `"error"` |
| `hits` | integer | Incremented counter value |

**Response** `500 Internal Server Error` — if Redis is unreachable.

---

### Aurora Ping

```
GET /db/ping
```

Runs a lightweight query against Aurora MySQL Writer endpoint to verify database connectivity.

**Response** `200 OK`

```json
{
  "color": "blue",
  "db": "connected",
  "query": "SELECT 1",
  "result": 1
}
```

| Field | Type | Description |
|-------|------|-------------|
| `color` | string | Serving tier color |
| `db` | string | `"connected"` or `"error"` |
| `query` | string | SQL statement executed |
| `result` | integer | Query result (`1`) |

**Response** `500 Internal Server Error` — if Aurora is unreachable.

---

### Root HTML

```
GET /
```

Returns an HTML page displaying the service color, version, and live stats. Useful for visual demonstration in a browser.

**Response** `200 OK` — HTML document.

---

## Error Codes

| Code | Description |
|------|-------------|
| 500 | Internal Server Error — Redis or Aurora connectivity failure |
| 502 | Bad Gateway — ECS task crashed or target group health check failing |
| 503 | Service Unavailable — ALB target group has no healthy targets |
| 403 | Forbidden — Request reached ALB without CloudFront X-Custom-Secret header |
