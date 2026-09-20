export interface ServerUrls {
  http: string;
  ws: string;
}

export interface BridgeEvent {
  type: string;
  [key: string]: unknown;
}

export type SocketMessage =
  | { kind: 'audio'; turnId: number; payload: ArrayBuffer }
  | { kind: 'event'; event: BridgeEvent }
  | { kind: 'invalid' };

export function resolveServerUrls(server: string, pageProtocol = 'http:'): ServerUrls {
  const clean = server.trim().replace(/\/+$/, '');
  const normalized = clean.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:');
  const explicit = /^https?:\/\//i.test(normalized);
  const protocol = pageProtocol === 'https:' ? 'https:' : 'http:';
  const url = new URL(explicit ? normalized : `${protocol}//${normalized}`);
  const secure = url.protocol === 'https:';
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  const http = `${secure ? 'https:' : 'http:'}//${url.host}${path}`;
  const ws = `${secure ? 'wss:' : 'ws:'}//${url.host}${path}/ws`;
  return { http, ws };
}

export function reconnectDelay(attempt: number) {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  return Math.min(8000, 500 * 2 ** safeAttempt);
}

export function parseSocketMessage(data: unknown): SocketMessage {
  if (data instanceof ArrayBuffer) {
    if (data.byteLength < 4) return { kind: 'invalid' };
    const turnId = new DataView(data).getUint32(0, true);
    return { kind: 'audio', turnId, payload: data.slice(4) };
  }

  if (typeof data !== 'string') return { kind: 'invalid' };

  try {
    const event = JSON.parse(data);
    if (!event || Array.isArray(event) || typeof event !== 'object' || typeof event.type !== 'string') {
      return { kind: 'invalid' };
    }
    return { kind: 'event', event };
  } catch {
    return { kind: 'invalid' };
  }
}

export function appendUniqueError(current: string[], message: string, limit = 5) {
  if (current.includes(message)) return current;
  return [...current.slice(-(limit - 1)), message];
}
