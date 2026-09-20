import crypto from 'node:crypto';

const loopback = (address) =>
  address === '127.0.0.1' ||
  address === '::1' ||
  String(address || '').startsWith('::ffff:127.');

const suppliedToken = (req) => {
  const direct = req.headers?.['x-honeypot-token'];
  if (direct) return String(direct);
  const authorization = String(req.headers?.authorization || '');
  if (/^Bearer /i.test(authorization)) return authorization.slice(7);
  try {
    return new URL(req.url || '/', 'http://localhost').searchParams.get('token') || '';
  } catch {
    return '';
  }
};

export function requestAuthorized(req, token) {
  if (!token) return loopback(req.socket?.remoteAddress);
  const supplied = suppliedToken(req);
  const expectedBuffer = Buffer.from(token);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export class SessionGate {
  constructor(limit) {
    this.limit = Math.max(1, Math.floor(Number(limit) || 1));
    this.sessions = new Set();
  }

  tryAdd(session) {
    if (this.sessions.has(session)) return true;
    if (this.sessions.size >= this.limit) return false;
    this.sessions.add(session);
    return true;
  }

  delete(session) {
    this.sessions.delete(session);
  }

  get size() {
    return this.sessions.size;
  }
}
