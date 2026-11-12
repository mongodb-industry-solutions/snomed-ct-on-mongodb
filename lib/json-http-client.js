// Server-side JSON requests with a total deadline. Node fetch's independent
// headers deadline can cut off a note even when its AbortSignal allows longer.
import http from 'node:http';
import https from 'node:https';

export function postJson(url, body, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    if (!['http:', 'https:'].includes(target.protocol)) return reject(new Error('Unsupported HTTP protocol'));
    const payload = Buffer.from(JSON.stringify(body));
    const request = transport.request(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': payload.length }
    });
    const timer = setTimeout(() => request.destroy(new Error(`Request timeout >${timeoutMs}ms`)), timeoutMs);
    const finish = (error, result) => {
      clearTimeout(timer);
      if (error) reject(error); else resolve(result);
    };
    request.on('error', error => finish(error));
    request.on('response', response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 32 * 1024 * 1024) request.destroy(new Error('JSON response exceeds size limit'));
        else chunks.push(chunk);
      });
      response.on('error', error => finish(error));
      response.on('end', () => {
        try { finish(null, { status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch { finish(new Error(`Invalid JSON response (HTTP ${response.statusCode})`)); }
      });
    });
    request.end(payload);
  });
}
