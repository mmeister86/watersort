import { createServer } from 'node:http';

// Placeholder health route. The real Hono app replaces this in Task 9.
const port = Number(process.env.PORT ?? 3000);

const server = createServer((request, response) => {
  if (request.url === '/api/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  response.writeHead(404);
  response.end();
});

server.listen(port, () => {
  console.log(`server listening on http://localhost:${port}`);
});
