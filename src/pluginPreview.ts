import type { SitePluginManifest } from './pluginManifest';

export type PreviewLogLevel = 'info' | 'warn' | 'error' | 'ready';
export type PluginTheme = 'light' | 'dark';

export interface PreviewLogMessage {
  level: PreviewLogLevel;
  message: string;
  details?: unknown;
  at: string;
}

export interface BuildPreviewSrcDocOptions {
  manifest: SitePluginManifest;
  rendererUrl: string;
  sampleData: unknown;
  sourceUrl: string;
  tile: {
    width: number;
    height: number;
  };
  theme: PluginTheme;
}

function htmlJson(value: unknown): string {
  return (JSON.stringify(value ?? null) ?? 'null').replace(/</g, '\\u003c');
}

export function buildPreviewSrcDoc({
  manifest,
  rendererUrl,
  sampleData,
  sourceUrl,
  tile,
  theme,
}: BuildPreviewSrcDocOptions): string {
  const manifestJson = htmlJson(manifest);
  const sampleJson = htmlJson(sampleData);
  const sourceUrlJson = htmlJson(sourceUrl);
  const tileJson = htmlJson(tile);
  const rendererUrlLiteral = JSON.stringify(rendererUrl);
  const themeLiteral = JSON.stringify(theme);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: transparent;
        color: #172033;
        --wpp-color-background: #ffffff;
        --wpp-color-surface: #f8fafc;
        --wpp-color-text: #172033;
        --wpp-color-muted: #64748b;
        --wpp-color-border: #dbe3ee;
        --wpp-color-accent: #2563eb;
      }
      :root[data-theme="dark"] {
        color-scheme: dark;
        color: #e5edf7;
        --wpp-color-background: #0b1220;
        --wpp-color-surface: #111c2f;
        --wpp-color-text: #e5edf7;
        --wpp-color-muted: #94a3b8;
        --wpp-color-border: #334155;
        --wpp-color-accent: #60a5fa;
      }
      * {
        box-sizing: border-box;
      }
      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
      }
      body {
        color: var(--wpp-color-text);
        background:
          radial-gradient(640px 420px at 22% 0%, rgba(77, 152, 255, 0.16), transparent 70%),
          var(--wpp-color-background);
      }
      #plugin-root {
        width: 100%;
        height: 100%;
        min-height: 0;
      }
      .wpp-preview-placeholder,
      .wpp-preview-error {
        height: 100%;
        display: grid;
        align-content: center;
        justify-items: center;
        gap: 10px;
        padding: 24px;
        text-align: center;
      }
      .wpp-preview-placeholder h1,
      .wpp-preview-error h1 {
        margin: 0;
        font-size: 18px;
        font-weight: 700;
      }
      .wpp-preview-placeholder p,
      .wpp-preview-error p {
        max-width: 420px;
        margin: 0;
        color: rgba(61, 75, 96, 0.78);
        font-size: 13px;
        line-height: 1.6;
      }
      .wpp-preview-error {
        background: rgba(254, 242, 242, 0.72);
        color: #991b1b;
      }
      .wpp-preview-error pre {
        width: min(100%, 520px);
        max-height: 180px;
        margin: 0;
        overflow: auto;
        padding: 12px;
        border: 1px solid rgba(248, 113, 113, 0.32);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.78);
        color: #7f1d1d;
        text-align: left;
        white-space: pre-wrap;
      }
      :root[data-theme="dark"] .wpp-preview-placeholder p,
      :root[data-theme="dark"] .wpp-preview-error p {
        color: var(--wpp-color-muted);
      }
      :root[data-theme="dark"] .wpp-preview-error {
        color: #fecaca;
        background: rgba(69, 10, 10, 0.62);
      }
      :root[data-theme="dark"] .wpp-preview-error pre {
        border-color: rgba(248, 113, 113, 0.28);
        color: #fecaca;
        background: rgba(30, 41, 59, 0.82);
      }
    </style>
  </head>
  <body>
    <script id="manifest-json" type="application/json">${manifestJson}</script>
    <script id="sample-json" type="application/json">${sampleJson}</script>
    <script id="source-url-json" type="application/json">${sourceUrlJson}</script>
    <script id="tile-json" type="application/json">${tileJson}</script>
    <div id="plugin-root"></div>
    <script type="module">
      const root = document.getElementById('plugin-root');
      const manifest = JSON.parse(document.getElementById('manifest-json').textContent || '{}');
      const sampleData = JSON.parse(document.getElementById('sample-json').textContent || 'null');
      const sourceUrl = JSON.parse(document.getElementById('source-url-json').textContent || '""');
      const tile = JSON.parse(document.getElementById('tile-json').textContent || '{}');
      const rendererUrl = ${rendererUrlLiteral};
      const theme = ${themeLiteral};
      document.documentElement.dataset.theme = theme;
      root.dataset.theme = theme;
      const nativeWindowOpen = window.open.bind(window);

      function emit(level, message, details) {
        window.parent.postMessage({
          source: 'wpp-dev-studio-preview',
          level,
          message,
          details,
          at: new Date().toISOString(),
        }, '*');
      }

      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function renderPlaceholder(message) {
        root.innerHTML = '<section class="wpp-preview-placeholder"><h1>' +
          escapeHtml(manifest.name || manifest.id || 'Plugin') +
          '</h1><p>' +
          escapeHtml(message) +
          '</p></section>';
      }

      function renderError(error) {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error && error.stack ? error.stack : message;
        root.innerHTML = '<section class="wpp-preview-error"><h1>Renderer failed</h1><p>' +
          escapeHtml(message) +
          '</p><pre></pre></section>';
        const pre = root.querySelector('pre');
        if (pre) pre.textContent = stack;
        emit('error', message, { stack });
      }

      function applyTileMetrics(nextTile) {
        const width = Number(nextTile && nextTile.width) || 0;
        const height = Number(nextTile && nextTile.height) || 0;
        tile.width = width;
        tile.height = height;
        root.dataset.tileWidth = String(width);
        root.dataset.tileHeight = String(height);
        root.style.setProperty('--wpp-tile-width', width + 'px');
        root.style.setProperty('--wpp-tile-height', height + 'px');
        window.dispatchEvent(new CustomEvent('wpp-tile-resize', { detail: { width, height } }));
      }

      applyTileMetrics(tile);

      function hasPermission(permission) {
        return Array.isArray(manifest.permissions) && manifest.permissions.includes(permission);
      }

      function readOpenWindowUrl(input) {
        if (input && typeof input === 'object') {
          return String(input.url || input.href || '');
        }
        return String(input || '');
      }

      function normalizeOpenWindowUrl(input) {
        const rawUrl = readOpenWindowUrl(input).trim();
        if (!rawUrl) return '';
        try {
          const parsed = new URL(rawUrl, sourceUrl || undefined);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return '';
          }
          return parsed.toString();
        } catch {
          return '';
        }
      }

      function requestOpenWindow(input, options) {
        const targetUrl = normalizeOpenWindowUrl(input);
        if (!targetUrl) {
          emit('warn', 'host.openWindow ignored invalid URL', { url: readOpenWindowUrl(input) });
          return false;
        }
        if (!hasPermission('openWindow')) {
          emit('warn', 'host.openWindow requires manifest.permissions openWindow', { url: targetUrl });
          return false;
        }
        emit('info', 'host.openWindow', { url: targetUrl });
        nativeWindowOpen(targetUrl, '_blank', 'noopener');
        return true;
      }

      window.open = (url, target, features) => {
        requestOpenWindow(url, { target, features });
        return null;
      };

      document.addEventListener('click', (event) => {
        const target = event.target;
        const anchor = target && typeof target.closest === 'function' ? target.closest('a[href]') : null;
        if (!anchor) return;
        const targetName = String(anchor.getAttribute('target') || '').toLowerCase();
        const shouldOpenInHost =
          targetName === '_blank' ||
          anchor.hasAttribute('data-wpp-open-window') ||
          event.metaKey ||
          event.ctrlKey;
        if (!shouldOpenInHost) return;
        event.preventDefault();
        event.stopPropagation();
        requestOpenWindow(anchor.getAttribute('href') || '', { target: targetName });
      }, true);

      window.addEventListener('error', (event) => {
        emit('error', event.message || 'window error', {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        });
      });
      window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        emit('error', reason instanceof Error ? reason.message : String(reason), {
          stack: reason instanceof Error ? reason.stack : undefined,
        });
      });
      window.addEventListener('message', (event) => {
        if (
          event.data &&
          typeof event.data === 'object' &&
          event.data.source === 'wpp-dev-studio-tile-size'
        ) {
          applyTileMetrics(event.data.tile || {});
        }
      });

      try {
        const module = await import(rendererUrl);
        const renderer = module.default ?? module.render ?? module;
        const host = {
          theme,
          log: (...args) => emit('info', args.map((item) =>
            typeof item === 'string' ? item : JSON.stringify(item)
          ).join(' '), args),
          warn: (...args) => emit('warn', args.map((item) =>
            typeof item === 'string' ? item : JSON.stringify(item)
          ).join(' '), args),
          setTitle: (title) => {
            window.parent.postMessage({
              source: 'wpp-dev-studio-title',
              title: String(title || ''),
              at: new Date().toISOString(),
            }, '*');
          },
          setStatus: (status) => emit('info', String(status || ''), { status }),
          openWindow: (url, options) => requestOpenWindow(url, options),
          openUrl: (url, options) => requestOpenWindow(url, options),
        };
        const context = {
          root,
          manifest,
          sampleData,
          data: sampleData,
          sourceUrl,
          tile,
          theme,
          host,
        };

        let result;
        if (typeof renderer === 'function') {
          result = await renderer(context);
        } else if (renderer && typeof renderer.render === 'function') {
          result = await renderer.render(context);
        } else if (renderer && typeof renderer.adapter === 'string') {
          renderPlaceholder('Loaded built-in adapter metadata. External renderer output is not present in this package.');
          emit('ready', 'adapter metadata loaded', renderer);
        } else {
          renderPlaceholder('Renderer entry loaded, but it does not export a render function.');
          emit('warn', 'renderer entry has no render function', Object.keys(module));
        }

        if (typeof result === 'string') {
          root.innerHTML = result;
        } else if (result instanceof Node) {
          root.appendChild(result);
        }
        emit('ready', 'renderer ready', { pluginId: manifest.id });
      } catch (error) {
        renderError(error);
      }
    </script>
  </body>
</html>`;
}

export function isPreviewLogMessage(value: unknown): value is PreviewLogMessage & { source: string } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.source === 'wpp-dev-studio-preview' &&
    typeof record.level === 'string' &&
    typeof record.message === 'string' &&
    typeof record.at === 'string'
  );
}
