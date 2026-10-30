const assert = require('node:assert/strict');
const http = require('node:http');
const { createServer } = require('../serve.js');
(async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const request = (url, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: url, method }, (res) => {
      let body = '';
      res.on('data', (data) => body += data);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject); req.end();
  });
  try {
    for (const [url, expected] of [
      ['/', 200], ['/js/app.js?v=1', 200], ['/manifest.webmanifest', 200], ['/missing.js', 404],
      ['/%', 400], ['/%E0%A4%A', 400], ['/%00', 400], ['/index.html:stream', 400],
      ['/.git/config', 403], ['/%2egit/config', 403], ['/../games-sibling/test.js', 403],
      ['/%2e%2e/games-sibling/test.js', 403], ['/..%5cgames-sibling/test.js', 400], ['/README.md', 403],
    ]) assert.equal((await request(url)).status, expected, url);
    assert.equal((await request('/', 'POST')).status, 405);
    assert.equal((await request('/', 'HEAD')).body, '');
    const home = await request('/');
    assert.match(home.body, /Game Night/);
    assert.equal(home.headers['x-content-type-options'], 'nosniff');
    assert.equal((await request('/js/app.js')).headers['content-type'], 'text/javascript');
    console.log('Server: 19 checks passed, including continued service after malformed URLs.');
  } finally { await new Promise((resolve) => server.close(resolve)); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
