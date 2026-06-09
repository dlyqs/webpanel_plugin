import type { SitePluginManifest } from './pluginManifest';

export type PreviewLogLevel = 'info' | 'warn' | 'error' | 'ready';

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
}

function htmlJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function buildPreviewSrcDoc({
  manifest,
  rendererUrl,
  sampleData,
}: BuildPreviewSrcDocOptions): string {
  const manifestJson = htmlJson(manifest);
  const sampleJson = htmlJson(sampleData);
  const rendererUrlLiteral = JSON.stringify(rendererUrl);

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
        background:
          radial-gradient(640px 420px at 22% 0%, rgba(77, 152, 255, 0.16), transparent 70%),
          linear-gradient(150deg, rgba(250, 252, 255, 0.98), rgba(240, 246, 252, 0.92));
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
    </style>
  </head>
  <body>
    <script id="manifest-json" type="application/json">${manifestJson}</script>
    <script id="sample-json" type="application/json">${sampleJson}</script>
    <div id="plugin-root"></div>
    <script type="module">
      const root = document.getElementById('plugin-root');
      const manifest = JSON.parse(document.getElementById('manifest-json').textContent || '{}');
      const sampleData = JSON.parse(document.getElementById('sample-json').textContent || 'null');
      const rendererUrl = ${rendererUrlLiteral};

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

      try {
        const module = await import(rendererUrl);
        const renderer = module.default ?? module.render ?? module;
        const host = {
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
        };
        const context = {
          root,
          manifest,
          sampleData,
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
