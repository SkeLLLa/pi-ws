import { PiPipe } from '../dist/index.js';

const pipe = new PiPipe({
  host: '127.0.0.1',
  port: 8787,
});

pipe.handle('get', '/api/hello', (res) => {
  res
    .writeHeader('content-type', 'application/json')
    .end(JSON.stringify({ hello: 'pi-pipe' }));
});

pipe.route('/ws/echo', {
  message(ws, message, isBinary) {
    ws.send(message, isBinary);
  },
});

const server = await pipe.listen();

console.log(`example listening on http://127.0.0.1:${String(server.port)}`);
console.log(`pi rpc websocket: ws://127.0.0.1:${String(server.port)}/ws/pi`);
console.log(
  `chat example: http://127.0.0.1:${String(server.port)}/examples/chat/`,
);

const stop = () => {
  pipe.close();
  process.exit(0);
};

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
