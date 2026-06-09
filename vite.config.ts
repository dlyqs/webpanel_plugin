import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function sendJson(response: import('node:http').ServerResponse, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('access-control-allow-origin', '*');
  response.end(JSON.stringify(payload));
}

function readRequestBody(request: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function createFetchProxyPlugin() {
  const handleFetchProxy = async (
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse,
    next: () => void,
  ) => {
    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.setHeader('access-control-allow-origin', '*');
      response.setHeader('access-control-allow-methods', 'POST, OPTIONS');
      response.setHeader('access-control-allow-headers', 'content-type');
      response.end();
      return;
    }

    if (request.method !== 'POST') {
      next();
      return;
    }

    try {
      const body = await readRequestBody(request);
      const payload = JSON.parse(body || '{}') as {
        url?: unknown;
        init?: {
          method?: unknown;
          headers?: unknown;
          body?: unknown;
        };
      };
      if (typeof payload.url !== 'string') {
        sendJson(response, 400, { error: 'Missing fetch URL.' });
        return;
      }

      const url = new URL(payload.url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        sendJson(response, 400, { error: 'Only http and https URLs are supported.' });
        return;
      }

      const method = typeof payload.init?.method === 'string' ? payload.init.method.toUpperCase() : 'GET';
      if (!['GET', 'HEAD', 'POST'].includes(method)) {
        sendJson(response, 400, { error: `Unsupported fetch method: ${method}` });
        return;
      }

      const headers =
        payload.init?.headers && typeof payload.init.headers === 'object' && !Array.isArray(payload.init.headers)
          ? (payload.init.headers as Record<string, string>)
          : {};
      const requestBody = typeof payload.init?.body === 'string' ? payload.init.body : undefined;
      const remoteResponse = await fetch(url, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : requestBody,
        redirect: 'follow',
      });
      const responseHeaders = Object.fromEntries(remoteResponse.headers.entries());
      sendJson(response, 200, {
        ok: remoteResponse.ok,
        status: remoteResponse.status,
        statusText: remoteResponse.statusText,
        url: remoteResponse.url,
        headers: responseHeaders,
        body: await remoteResponse.text(),
      });
    } catch (error) {
      sendJson(response, 502, {
        error: error instanceof Error ? error.message : 'Remote fetch failed.',
      });
    }
  };

  return {
    name: 'wpp-dev-studio-fetch-proxy',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use('/__wpp_dev_studio/fetch', handleFetchProxy);
    },
    configurePreviewServer(server: import('vite').PreviewServer) {
      server.middlewares.use('/__wpp_dev_studio/fetch', handleFetchProxy);
    },
  };
}

export default defineConfig({
  plugins: [react(), createFetchProxyPlugin()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
