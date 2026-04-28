const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

process.env.COLOR = 'blue';
process.env.COMPUTE_TYPE = 'ec2-asg';
process.env.PORT = '0';
process.env.SKIP_DEPS = '1';

const { createApp } = require('../server.js');

function request(app, path) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, () => {
      const port = server.address().port;
      http.get(`http://127.0.0.1:${port}${path}`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, body }); });
      }).on('error', (e) => { server.close(); reject(e); });
    });
  });
}

test('GET /health returns 200 with color and compute', async () => {
  const r = await request(createApp(), '/health');
  assert.strictEqual(r.status, 200);
  const j = JSON.parse(r.body);
  assert.strictEqual(j.status, 'healthy');
  assert.strictEqual(j.color, 'blue');
  assert.strictEqual(j.compute, 'ec2-asg');
});

test('GET /info returns json with color, compute, hostname', async () => {
  const r = await request(createApp(), '/info');
  assert.strictEqual(r.status, 200);
  const j = JSON.parse(r.body);
  assert.strictEqual(j.color, 'blue');
  assert.strictEqual(j.compute, 'ec2-asg');
  assert.ok(typeof j.hostname === 'string');
});

test('GET / returns HTML page styled by color', async () => {
  const r = await request(createApp(), '/');
  assert.strictEqual(r.status, 200);
  assert.match(r.body, /<html/);
  assert.match(r.body, /BLUE/);
});
