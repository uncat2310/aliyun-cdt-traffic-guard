import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { STATIC_DIR, settings } from './config.js';
import { logger } from './logger.js';
import { overviewCache, historyCache, getCachedOverview } from './monitor.js';
import { createPayload } from './payload.js';

// ================== HTTP 服务 ==================
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};
const COMPRESSIBLE_EXTS = new Set(['.html', '.js', '.css', '.json', '.svg', '.ico', '.ttf']);
const JSON_TYPE = 'application/json; charset=utf-8';
const HTML_TYPE = 'text/html; charset=utf-8';
const STATIC_CACHE_MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const FALLBACK_HTML = Buffer.from(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>流量守卫</title></head>
<body><h2>🚀 流量守卫服务启动中...</h2></body></html>`);

/** 内联到 <script> 时转义 <、>、& 与行分隔符，防止 </script> 截断导致 XSS。 */
export function jsonForScript(data) {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest();

export function checkBasicAuth(headerValue) {
  if (!settings.authPassword) return true;
  if (!headerValue || !headerValue.startsWith('Basic ')) return false;
  const decoded = Buffer.from(headerValue.slice(6).trim(), 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep < 0) return false;
  // 比较定长摘要，避免逐字节比较泄露时序信息
  const userOk = crypto.timingSafeEqual(sha256(decoded.slice(0, sep)), sha256(settings.authUsername));
  const passOk = crypto.timingSafeEqual(sha256(decoded.slice(sep + 1)), sha256(settings.authPassword));
  return userOk && passOk;
}

const isTruthy = (value) => ['1', 'true', 'True'].includes(value);

export function createDashboardServer({ staticDir = STATIC_DIR } = {}) {
  const staticRoot = fs.existsSync(staticDir) ? fs.realpathSync(staticDir) : path.resolve(staticDir);
  const staticCache = new Map();
  const indexCache = { template: null, payload: null };
  let fallbackPayload;

  /** 把 URL 路径映射到 dashboard_dist 内的真实文件；越界（../、符号链接等）返回 null。 */
  async function resolveStaticFile(urlPath) {
    let rel;
    try {
      rel = decodeURIComponent(urlPath);
    } catch {
      return null;
    }
    if (rel.includes('\0')) return null;
    rel = path.posix.normalize(`/${rel.replace(/\\/g, '/')}`).replace(/^\/+/, '');
    let real;
    try {
      real = await fsp.realpath(path.join(staticRoot, rel));
    } catch {
      return null;
    }
    if (real !== staticRoot && !real.startsWith(staticRoot + path.sep)) return null;
    const st = await fsp.stat(real);
    if (!st.isFile()) return null;
    return { file: real, rel: path.relative(staticRoot, real).split(path.sep).join('/'), st };
  }

  async function loadStatic({ file, st }) {
    const key = `${st.mtimeMs}:${st.size}`;
    const entry = staticCache.get(file);
    if (entry?.key === key) return entry.payload;
    const content = await fsp.readFile(file);
    const payload = await createPayload(content, COMPRESSIBLE_EXTS.has(path.extname(file).toLowerCase()));
    if (st.size <= STATIC_CACHE_MAX_FILE_BYTES) staticCache.set(file, { key, payload });
    return payload;
  }

  async function indexTemplate(htmlFile) {
    const st = await fsp.stat(htmlFile);
    const key = `${st.mtimeMs}:${st.size}`;
    if (indexCache.template?.key !== key) {
      const raw = await fsp.readFile(htmlFile, 'utf8');
      const at = raw.indexOf('</head>');
      indexCache.template = { key, raw, parts: at < 0 ? null : [raw.slice(0, at), raw.slice(at + 7)] };
    }
    return indexCache.template;
  }

  async function buildIndexPayload(htmlFile) {
    const [overview, history] = await Promise.all([overviewCache.get(), historyCache.get()]);
    const template = await indexTemplate(htmlFile);
    const cached = indexCache.payload;
    if (cached && cached.template === template && cached.overview === overview && cached.history === history) {
      return cached.payload;
    }
    let html = template.raw;
    if (template.parts) {
      const initialState = jsonForScript({ overview: overview.data, history: history.data });
      html = `${template.parts[0]}<script>window.__INITIAL_DATA__ = ${initialState};</script></head>${template.parts[1]}`;
    }
    const payload = await createPayload(Buffer.from(html));
    indexCache.payload = { template, overview, history, payload };
    return payload;
  }

  function setCommonHeaders(res) {
    if (settings.corsAllowOrigin) {
      res.setHeader('Access-Control-Allow-Origin', settings.corsAllowOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (settings.corsAllowOrigin !== '*') res.setHeader('Vary', 'Origin');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
  }

  function sendText(req, res, code, text, headers = {}) {
    const body = Buffer.from(text);
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length, ...headers });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  function sendPayload(req, res, payload, contentType, { code = 200, immutable = false, noCache = false } = {}) {
    const useGzip = payload.gzipped !== null && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const body = useGzip ? payload.gzipped : payload.body;
    const headers = {
      'Content-Type': contentType,
      'Cache-Control': noCache
        ? 'no-cache, no-store, must-revalidate'
        : immutable
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=3600',
      'Content-Length': body.length,
    };
    if (payload.gzipped !== null) headers.Vary = 'Accept-Encoding';
    if (useGzip) headers['Content-Encoding'] = 'gzip';
    res.writeHead(code, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  async function sendFallback(req, res) {
    fallbackPayload ??= await createPayload(FALLBACK_HTML);
    sendPayload(req, res, fallbackPayload, HTML_TYPE, { noCache: true });
  }

  async function serveIndex(req, res) {
    const htmlFile = path.join(staticRoot, 'index.html');
    if (!fs.existsSync(htmlFile)) {
      await sendFallback(req, res);
      return;
    }
    let payload;
    try {
      payload = await buildIndexPayload(htmlFile);
    } catch (e) {
      logger.error(`Error injecting HTML data: ${e.message}`);
      sendText(req, res, 500, 'Error serving index');
      return;
    }
    sendPayload(req, res, payload, HTML_TYPE, { noCache: true });
  }

  async function serveStatic(req, res, urlPath) {
    if (!fs.existsSync(staticRoot)) {
      await sendFallback(req, res);
      return;
    }
    const resolved = await resolveStaticFile(urlPath);
    if (!resolved || resolved.rel === 'index.html') {
      await serveIndex(req, res);
      return;
    }
    let payload;
    try {
      payload = await loadStatic(resolved);
    } catch (e) {
      logger.error(`Error reading static file ${resolved.file}: ${e.message}`);
      sendText(req, res, 500, 'Error reading file');
      return;
    }
    const mime = MIME_TYPES[path.extname(resolved.file).toLowerCase()] || 'application/octet-stream';
    // 只有 Vite 输出到 assets/ 的带哈希文件名才可以永久缓存
    sendPayload(req, res, payload, mime, { immutable: resolved.rel.startsWith('assets/') });
  }

  /** 读掉（并限制）请求体，超限返回 false。 */
  function drainBody(req) {
    return new Promise((resolve) => {
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_REQUEST_BODY_BYTES) {
          req.removeAllListeners('data');
          req.resume();
          resolve(false);
        }
      });
      req.on('end', () => resolve(size <= MAX_REQUEST_BODY_BYTES));
      req.on('error', () => resolve(false));
    });
  }

  async function handle(req, res) {
    setCommonHeaders(res);
    const { method } = req;

    if (method === 'OPTIONS') {
      res.writeHead(204, { Allow: 'GET, HEAD, POST, OPTIONS', 'Content-Length': 0 });
      res.end();
      return;
    }
    if (!['GET', 'HEAD', 'POST'].includes(method)) {
      sendText(req, res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD, POST, OPTIONS' });
      return;
    }
    if (method === 'POST') {
      const declared = Number(req.headers['content-length'] || 0);
      if (declared > MAX_REQUEST_BODY_BYTES || !(await drainBody(req))) {
        sendText(req, res, 413, 'Payload Too Large', { Connection: 'close' });
        return;
      }
    }
    if (!checkBasicAuth(req.headers.authorization)) {
      sendText(req, res, 401, 'Unauthorized', {
        'WWW-Authenticate': 'Basic realm="Traffic Guard", charset="UTF-8"',
      });
      return;
    }

    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      sendText(req, res, 400, 'Bad Request');
      return;
    }
    const force = isTruthy(url.searchParams.get('force'));

    if (method === 'POST') {
      if (url.pathname === '/api/refresh') {
        const data = await getCachedOverview(true);
        const payload = await createPayload(Buffer.from(JSON.stringify({ success: true, message: 'Refreshed successfully', data })));
        sendPayload(req, res, payload, JSON_TYPE, { noCache: true });
        return;
      }
      sendText(req, res, 404, 'Endpoint not found');
      return;
    }

    if (url.pathname === '/api/overview' || url.pathname === '/api/stats') {
      sendPayload(req, res, (await overviewCache.get(force)).payload, JSON_TYPE, { noCache: true });
      return;
    }
    if (url.pathname === '/api/history') {
      sendPayload(req, res, (await historyCache.get(force)).payload, JSON_TYPE, { noCache: true });
      return;
    }
    await serveStatic(req, res, url.pathname);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      logger.error(`Unhandled request error for ${req.method} ${req.url}: ${e.message}`);
      if (!res.headersSent) {
        sendText(req, res, 500, 'Internal Server Error');
      } else {
        res.destroy();
      }
    });
  });
  // 限制慢连接占用
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  return server;
}
