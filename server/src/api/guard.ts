import type { NextFunction, Request, Response } from 'express';
import { errorBody, sendJson } from './http.ts';

/**
 * Local-only request guard (runs before body parsing and before every route).
 *
 * The API listens on 127.0.0.1 and has no auth: it is a single-user local app. That alone does
 * not stop a web page in the user's browser from talking to it:
 *   - cross-site "simple" requests (a no-cors fetch / an HTML form posting text/plain, or a
 *     body-less POST) reach POST routes without a CORS preflight. Body-less routes such as
 *     POST /units/:id/reveal (irreversible: 0 XP forever) accepted them, because a missing
 *     body validates as `{}`;
 *   - DNS rebinding makes an attacker's hostname resolve to 127.0.0.1, so its page is
 *     SAME-origin with the API and can read responses (refs content) and POST code to /run.
 *
 * Three checks, in order, each a JSON error and nothing else runs:
 *   1. Host must be a loopback name (127.0.0.1 / localhost / [::1], any port)  -> 403 HOST_NOT_ALLOWED
 *      (defeats DNS rebinding: the browser sends the attacker's hostname as Host);
 *   2. an Origin header, when present, must be a loopback http(s) origin       -> 403 ORIGIN_NOT_ALLOWED
 *      (absent Origin = the CLI / scripts / same-origin browser GETs, allowed);
 *   3. every non-GET/HEAD request must declare Content-Type: application/json -> 415 UNSUPPORTED_MEDIA_TYPE
 *      (a cross-site page cannot send that type without a CORS preflight, which this server never grants).
 *
 * The Vite dev proxy (client/vite.config.ts) does not set changeOrigin, so it forwards the
 * browser's own Host (localhost:5173) and Origin (http://localhost:5173): both pass.
 */

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);
const HOST_RE = /^(127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i;

export function isLoopbackHost(host: string | undefined): boolean {
  return typeof host === 'string' && HOST_RE.test(host.trim());
}

export function isLoopbackOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false; // includes the opaque "null" origin (sandboxed iframes, file://)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  // an origin is scheme://host[:port] only: anything else is not a browser-sent Origin
  if (url.username || url.password || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) return false;
  return LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase());
}

export function isJsonContentType(raw: string | undefined): boolean {
  if (typeof raw !== 'string') return false;
  return raw.split(';')[0]!.trim().toLowerCase() === 'application/json';
}

const SAFE_METHODS = new Set(['GET', 'HEAD']);
const shown = (v: string | undefined): string => JSON.stringify(v === undefined ? null : v.slice(0, 200));

export function localOnlyGuard(req: Request, res: Response, next: NextFunction): void {
  if (!isLoopbackHost(req.headers.host)) {
    sendJson(res, 403, errorBody('HOST_NOT_ALLOWED', `this local API only answers requests addressed to 127.0.0.1, localhost or [::1] (Host: ${shown(req.headers.host)})`));
    return;
  }
  const origin = req.headers.origin;
  if (origin !== undefined && !isLoopbackOrigin(origin)) {
    sendJson(res, 403, errorBody('ORIGIN_NOT_ALLOWED', `cross-origin requests are refused (Origin: ${shown(origin)})`));
    return;
  }
  if (!SAFE_METHODS.has(req.method) && !isJsonContentType(req.headers['content-type'])) {
    sendJson(
      res,
      415,
      errorBody('UNSUPPORTED_MEDIA_TYPE', `${req.method} requests must send Content-Type: application/json (send {} when there is nothing else to send)`),
    );
    return;
  }
  next();
}
