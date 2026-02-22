const fs = require('fs');
const http = require('http');
const logPath = process.argv[2];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => body += d.toString());
  req.on('end', () => {
    fs.appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), method: req.method, url: req.url, body }) + '\n');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
});
server.listen(19090, '127.0.0.1', () => console.log('listening 19090'));
