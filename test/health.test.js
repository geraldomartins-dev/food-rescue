import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters';

let server;
let baseUrl;

before(async () => {
  const { app } = await import('../src/app.js');
  await new Promise((done) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });
});

after(() => new Promise((done) => server.close(done)));

test('health responde sem acessar o banco', async () => {
  const response = await fetch(`${baseUrl}/api/v1/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  assert.ok(response.headers.get('x-request-id'));
});

test('404 usa o contrato padronizado', async () => {
  const response = await fetch(`${baseUrl}/nao-existe`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'ROUTE_NOT_FOUND');
});
