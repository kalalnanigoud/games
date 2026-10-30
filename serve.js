// Local development server: node serve.js (loopback only by default).
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const inside = (root, file) => {
  const rel = path.relative(root, file);
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
};
function createServer(directory = __dirname) {
  const root = path.resolve(directory);
  return http.createServer(async (req, res) => {
    const fail = (status, message) => { res.writeHead(status, { 'Content-Type': 'text/plain' }); res.end(message); };
    if (!['GET', 'HEAD'].includes(req.method)) return fail(405, 'Method not allowed');
    let url;
    try { url = decodeURIComponent(req.url.split('?')[0]); }
    catch { return fail(400, 'Malformed URL'); }
    // Reject Windows separators, alternate data streams, and hidden files.
    if (/[\0\\:]/.test(url)) return fail(400, 'Invalid path');
    const file = path.resolve(root, '.' + (url === '/' ? '/index.html' : url));
    if (!inside(root, file) || url.split('/').some((part) => part.startsWith('.'))) return fail(403, 'Forbidden');
    if (!types[path.extname(file)]) return fail(403, 'Forbidden');
    try {
      const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(file)]);
      if (!inside(realRoot, realFile) || path.relative(realRoot, realFile).split(path.sep).some((part) => part.startsWith('.'))) return fail(403, 'Forbidden');
      if (!(await fs.stat(realFile)).isFile()) return fail(404, 'Not found');
      const data = await fs.readFile(realFile);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { fail(404, 'Not found'); }
  });
}
if (require.main === module) {
  const port = process.env.PORT || 8080;
  const host = process.env.HOST || '127.0.0.1';
  createServer().listen(port, host, () => console.log(`Game Night running at http://${host}:${port}`));
}
module.exports = { createServer };
