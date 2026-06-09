---
name: wpp-plugin-builder
description: Use when creating, updating, validating, packaging, or explaining third-party WebPanel WPP plugins inside the standalone WPP Dev Studio project.
---

# WPP Plugin Builder

Use this skill when the user wants to build a WebPanel `.wpp` plugin with the standalone `webpanel_plugin` WPP Dev Studio project.

## Start Here

Read these files first:

- `README.md`
- `examples/simple-widget/manifest.json`
- `examples/simple-widget/renderer/index.js`
- `src/pluginManifest.ts`
- `src/pluginPreview.ts`

If this project is checked out inside the private WebPanel repository and the user asks how the generated package behaves in the current desktop app, also read:

- `../../docs/plugins/PLUGIN_PACKAGE_FORMAT.md`
- `../../electron/main/sitePluginPackageStore.ts`

Do not require private WebPanel app source for ordinary third-party plugin work. Treat the public contract in this project as the source of truth unless the user explicitly asks about host internals.

## Working Directory

Create user plugins under:

```text
workspace/<plugin-id>/
```

The `workspace/` directory is intentionally present for local plugin development and its contents are ignored by git. Keep distributable examples under `examples/`; keep user work under `workspace/`.

## Package Shape

Every plugin directory must have this package root:

```text
manifest.json
renderer/index.js
main/index.js
assets/**        optional
```

Do not place the files under an extra top-level folder inside the package root.

## Manifest Rules

Use snake_case public fields in `manifest.json`:

```json
{
  "id": "vendor-example-widget",
  "name": "Example Widget",
  "version": "1.0.0",
  "plugin_api_version": "1.0.0",
  "description": "Short description.",
  "author": "Your Name",
  "host_patterns": ["*.example.com"],
  "permissions": ["network"],
  "entry": {
    "renderer": "renderer/index.js",
    "main": "main/index.js"
  },
  "runtime": {
    "type": "external-module"
  }
}
```

Rules:

- `id` must match `/^[a-z0-9][a-z0-9._-]{1,63}$/`.
- `plugin_api_version` must be `1.0.0`.
- `permissions` can only include `cookies`, `executeScript`, `network`, and `openWindow`.
- `entry.renderer` and `entry.main` must exist inside the package.
- Third-party plugins should use `runtime.type = "external-module"`.
- Do not use `builtin-adapter` for third-party plugins. It is reserved for controlled host adapters.

Important current boundary: WPP Dev Studio can preview and package `external-module` plugins, and the WebPanel desktop app can install and run them through the constrained main runtime plus renderer sandbox iframe. Keep sandbox limits explicit in user-facing answers: no main `require()`, no direct Electron API, and renderer code runs inside an iframe.

## Renderer Contract

`renderer/index.js` is loaded as an ES module inside the preview iframe after `main/index.js` has produced preview data. Export either a function or an object with `render(context)`:

```js
export default {
  render({ root, manifest, sampleData, host }) {
    host.setTitle(manifest.name);
    host.log('render', { pluginId: manifest.id });
    root.innerHTML = '<div>Hello WPP</div>';
  },
};
```

The context includes:

- `root`: the tile root element.
- `manifest`: normalized manifest metadata.
- `sampleData`: the main output in Main Output mode, or the JSON scenario selected or edited in Manual JSON mode.
- `data`: alias for `sampleData`.
- `tile`: current simulated tile width and height in pixels.
- `sourceUrl`: the URL entered in the Runtime panel and the base URL for relative links.
- `host.log(...)` and `host.warn(...)`: console messages forwarded to the studio.
- `host.setTitle(title)`: updates the simulated tile title.
- `host.setStatus(status)`: emits a status message.
- `host.openWindow(url)`: official API for opening a detail page or external link in a host-managed new window. Require `"openWindow"` in `manifest.permissions` before using it.
- `host.openUrl(url)`: compatibility alias for `host.openWindow(url)`.

Do not import private WebPanel modules, use Node.js APIs, or assume `window.electronAPI` exists. Keep renderer code deterministic from `sampleData`, `sourceUrl`, and `tile`. Do not rely on native popup behavior; the host intercepts `window.open(...)`, `target="_blank"` links, and `data-wpp-open-window` links and applies the same `openWindow` permission check.

## Main Entry

`main/index.js` runs in the studio runtime before renderer preview. Use CommonJS exports. It may export a function, an object with `resolve(context)`, or an object with `activate(context)` plus `resolve(context)`.

```js
module.exports = {
  activate(context) {
    return {
      pluginId: context?.manifest?.id,
      status: 'ready',
      sourceUrl: 'https://example.com/feed',
    };
  },

  async resolve({ sourceUrl, host }) {
    const data = await host.fetchJson(sourceUrl);
    return {
      url: sourceUrl,
      updatedAt: new Date().toISOString(),
      data,
    };
  },
};
```

The main context includes `manifest`, `sourceUrl`, `sampleData`, `request.operation = "preview"`, and `host`.
The host includes `log`, `warn`, `setStatus`, `fetch`, `fetchText`, and `fetchJson`.
The Vite dev/preview server proxies `host.fetch*` requests from Node so local previews are not blocked by browser CORS. Do not call `require()` from main; bundle dependencies into `main/index.js`.

## Validation

Run static validation before handing off:

```bash
pnpm run wpp:validate -- workspace/<plugin-id>
```

Run package generation when the user asks for a `.wpp` artifact:

```bash
pnpm run wpp:pack -- workspace/<plugin-id>
```

The default output directory is `dist-plugins/`, which is ignored by git.

Run the studio build when changing studio source or shared contracts:

```bash
pnpm build
```

Do not open the browser preview, Browser plugin, or Playwright unless the user explicitly asks for a rendered inspection.

## Delivery Checklist

- Plugin files live under `workspace/<plugin-id>/`.
- `manifest.json` validates with `pnpm run wpp:validate`.
- Renderer exports a valid render function and handles missing sample fields.
- Text and data are escaped before writing HTML strings.
- Generated `.wpp` excludes `.git`, `node_modules`, `.DS_Store`, and existing `.wpp` files.
- User-facing notes distinguish Dev Studio preview support from current desktop host execution support.
