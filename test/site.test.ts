import test from 'node:test';
import assert from 'node:assert/strict';
import site from '../apps/site/src/index.ts';

test('landing host redirects aliases and serves canonical assets', async () => {
  let requests = 0;
  const env = { PUBLIC_URL: 'https://jevmod.us', ASSETS: { fetch: async (request: Request) => {
    requests++;
    return new Response(new URL(request.url).pathname === '/' ? 'Landing' : 'Missing', { status: new URL(request.url).pathname === '/' ? 200 : 404 });
  } } as unknown as Fetcher };
  for (const url of ['http://jevmod.us/path?ref=test', 'https://www.jevmod.us/path?ref=test']) {
    const response = await site.fetch(new Request(url), env);
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), 'https://jevmod.us/path?ref=test');
  }
  assert.equal(requests, 0);
  assert.equal(await (await site.fetch(new Request('https://jevmod.us/'), env)).text(), 'Landing');
  assert.equal((await site.fetch(new Request('https://jevmod.us/missing'), env)).status, 404);
});
