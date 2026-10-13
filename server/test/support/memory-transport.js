const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { IncomingMessage, ServerResponse } = require('node:http');
const { PassThrough } = require('node:stream');

// Model the transport only: production handlers, JWTs, Express middleware, and
// SQLite still run unchanged. JSON copies prevent shared references from hiding
// bugs that would occur across a real Socket.IO connection.
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const events = () => {
  const emitter = new EventEmitter();
  emitter.on('error', () => {}); // Socket.IO treats "error" as an ordinary event.
  return emitter;
};

class MemorySocketServer extends EventEmitter {
  sockets = { sockets: new Map() };

  client() {
    const incoming = events();
    const io = this;
    const client = {
      connected: false,
      on(event, listener) { incoming.on(event, listener); return this; },
      off(event, listener) { incoming.off(event, listener); return this; },
      connect() {
        if (this.connected) return this;
        this.connected = true;
        this.id = randomUUID();
        const handlers = events();
        const socket = {
          id: this.id, connected: true, rooms: new Set([this.id]),
          on(event, listener) { handlers.on(event, listener); },
          join(room) { this.rooms.add(room); },
          leave(room) { this.rooms.delete(room); },
          emit(event, data) {
            const message = copy(data);
            queueMicrotask(() => {
              if (socket.connected) incoming.emit(event, message);
            });
          },
          handlers
        };
        this.serverSocket = socket;
        io.sockets.sockets.set(socket.id, socket);
        io.emit('connection', socket);
        queueMicrotask(() => {
          if (socket.connected) incoming.emit('connect');
        });
        return this;
      },
      disconnect() {
        if (!this.connected) return this;
        this.connected = false;
        const socket = this.serverSocket;
        socket.connected = false;
        io.sockets.sockets.delete(socket.id);
        socket.handlers.emit('disconnect', 'client namespace disconnect');
        incoming.emit('disconnect', 'io client disconnect');
        return this;
      },
      emit(event, ...args) {
        const socket = this.serverSocket;
        if (!socket?.connected) return this;
        const message = args.map(arg => typeof arg === 'function'
          ? result => queueMicrotask(() => arg(copy(result)))
          : copy(arg));
        queueMicrotask(() => {
          if (socket.connected) socket.handlers.emit(event, ...message);
        });
        return this;
      },
      timeout(ms) {
        return {
          emit(event, data, acknowledge) {
            const timer = setTimeout(() => acknowledge(new Error(`Ack timed out: ${event}`)), ms);
            client.emit(event, data, result => {
              clearTimeout(timer);
              acknowledge(null, result);
            });
          }
        };
      }
    };
    return client;
  }

  to(room) {
    return {
      emit: (event, data) => {
        for (const socket of this.sockets.sockets.values()) {
          if (socket.rooms.has(room)) socket.emit(event, data);
        }
      }
    };
  }

  close(done) { done(); }
}

function request(app, path, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = new IncomingMessage(new PassThrough());
    req.method = method;
    req.url = path;
    req.headers = { host: 'test.local', ...headers };
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    if (payload) {
      req.headers['content-type'] = 'application/json';
      req.headers['content-length'] = String(payload.length);
      req.push(payload);
    }
    req.push(null);
    const res = new ServerResponse(req);
    res.end = chunk => {
      res.finished = true;
      try {
        resolve({ status: res.statusCode, ...JSON.parse(String(chunk)) });
      } catch (error) {
        reject(error);
      }
      return res;
    };
    app.handle(req, res, error => reject(error || new Error(`Unhandled route: ${path}`)));
  });
}

module.exports = { MemorySocketServer, request };
