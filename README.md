# WPP Dev Studio

Standalone local development studio for WebPanel `.wpp` plugins.

This project is designed to be distributed independently from the closed WebPanel desktop app. It simulates the plugin tile rendering surface, runs the plugin `main/index.js` entry against a source URL, validates an unpacked plugin directory, and packages that directory into a `.wpp` archive. It does not include WebPanel's web component selection, injection, source mirror, BrowserView, or Electron window orchestration code.

## Run

```bash
pnpm install
pnpm dev
```

Inside this repository you can also run it from the repo root:

```bash
pnpm --dir tools/webpanel_plugin dev
```

## Project Layout

```text
webpanel_plugin/
  .codex/skills/wpp-plugin-builder/  Codex skill for creating local WPP plugins
  examples/simple-widget/            Reference plugin that should stay distributable
  scripts/wpp-plugin.mjs             CLI validator and packer
  src/                               Studio UI and preview runtime
  workspace/                         Local user plugin work area, ignored by git
```

Put plugins you are actively developing under `workspace/<plugin-id>/`. The directory is intentionally present in the repo, but its contents are ignored so local user plugins do not become part of the studio distribution.

## Local Workflow

1. Create or copy plugins into `workspace/<plugin-id>/`.
2. Validate a plugin with `pnpm run wpp:validate -- workspace/<plugin-id>`.
3. Open the studio. It will ask for a directory; choose `workspace/` to let the studio detect local plugins, or choose a single plugin directory.
4. If the selected directory contains multiple plugins, pick one from the Workspace Plugin dropdown.
5. Enter a source URL and run `main/index.js`, or switch to Manual JSON and edit a `sampleData` test case.
6. Preview the plugin renderer in both Light and Dark with the Host Theme control.
7. Use browser DevTools or the studio console to debug renderer output.
8. Resize the simulated tile with the size controls or the tile resize handle.
9. Package the directory as `<plugin-id>.wpp`.

Upload is intentionally not included here. Users upload the generated `.wpp` from the main WebPanel app, where account login and marketplace permissions already exist.

## Plugin Directory Shape

```text
my-plugin/
  manifest.json
  renderer/index.js
  main/index.js
```

`manifest.json` follows the public WPP manifest format:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "plugin_api_version": "1.0.0",
  "description": "Short description.",
  "author": "Your Name",
  "host_patterns": ["*.example.com"],
  "default_launch_url": "https://example.com/",
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

URL-matched plugins must provide `default_launch_url`; it is the default URL used when a user clicks the installed plugin from WebPanel's new tile panel. Utility plugins that do not launch from a URL do not need this field.

The studio strips the selected browser directory prefix so the package root contains `manifest.json`.

## CLI Validation and Packaging

The UI can package plugins in the browser, and the same project also includes a small Node.js CLI for agent or terminal workflows:

```bash
pnpm run wpp:validate -- workspace/my-plugin
pnpm run wpp:pack -- workspace/my-plugin
```

`wpp:pack` writes `dist-plugins/<plugin-id>.wpp` and prints the SHA-256 digest. The packer excludes `.DS_Store`, existing `.wpp` files, `.git`, and `node_modules`.

## Main Contract

The main entry is executed in the studio runtime before renderer preview. It may export a function, an object with `resolve(context)`, or an object with `activate(context)` plus `resolve(context)`.

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
    const html = await host.fetchText(sourceUrl);
    return {
      url: sourceUrl,
      updatedAt: new Date().toISOString(),
      html,
    };
  },
};
```

The main context contains:

- `manifest`: normalized manifest metadata.
- `sourceUrl`: the URL entered in the Runtime panel.
- `sampleData`: the JSON scenario selected or edited in Dev Studio, useful as seed input.
- `request.operation`: currently `preview`.
- `host.log(...)`, `host.warn(...)`, `host.setStatus(...)`: messages forwarded to the studio console.
- `host.fetch(...)`, `host.fetchText(...)`, `host.fetchJson(...)`: network helpers. The Vite dev/preview server proxies these requests from Node so local previews are not blocked by browser CORS.

`main/index.js` should use CommonJS exports for studio preview. Bundle dependencies into the entry file; `require()` is not available in the browser runtime.

## Renderer Contract

The renderer entry is loaded as an ES module inside the preview iframe. It can export either a function or an object with `render(context)`.

```js
export default {
  render({ root, manifest, sampleData, theme, host }) {
    host.log('render', manifest.id);
    root.innerHTML = `<h1 style="color:var(--wpp-color-text)">${manifest.name} · ${theme}</h1>`;
  }
};
```

The preview context contains:

- `root`: the tile root element.
- `manifest`: normalized manifest metadata.
- `sampleData`: the main output in Main Output mode, or the selected JSON test case in Manual JSON mode.
- `data`: alias for `sampleData`.
- `tile`: current simulated tile width and height in pixels.
- `sourceUrl`: the URL entered in the Runtime panel, also used as the base for relative links.
- `theme`: the host's current `"light" | "dark"` value. The same value is available as `host.theme` and `root.dataset.theme`; plugins should implement both palettes and must not persist a separate theme preference.
- `host.log(...)`, `host.warn(...)`: messages forwarded to the studio console.
- `host.setTitle(title)`: updates the simulated tile title.
- `host.setStatus(status)`: emits a status message to the studio console.
- `host.openWindow(url)`: requests the host to open a new window. The manifest must include the `openWindow` permission.
- `host.openUrl(url)`: compatibility alias for `host.openWindow(url)`.

The iframe also defines `--wpp-color-background`, `--wpp-color-surface`, `--wpp-color-text`, `--wpp-color-muted`, `--wpp-color-border`, and `--wpp-color-accent`. Prefer these tokens for normal palette work. The distributable `examples/simple-widget` demonstrates this contract.

The desktop host also intercepts `window.open(...)`, `target="_blank"` links, and links marked with `data-wpp-open-window`; all of them require `openWindow` permission. Prefer `host.openWindow(url)` in plugin code so the behavior is explicit.

## Packaging

The browser packer creates a ZIP32 archive with `.wpp` extension. It excludes `.DS_Store`, `.wpp` files, `.git`, and `node_modules`. The output is downloaded locally and includes a SHA-256 digest in the UI.

## Runtime Boundary

Third-party plugins should use `runtime.type = "external-module"` while developing in WPP Dev Studio. The studio can preview and package that renderer contract today.

The current WebPanel desktop local install path supports controlled `builtin-adapter` packages and third-party `external-module` packages. `external-module` main code runs in a constrained host runtime and renderer code runs in a tile sandbox iframe; do not depend on Node.js `require()` or direct Electron APIs.

## Codex Skill

This project ships a local skill at `.codex/skills/wpp-plugin-builder/SKILL.md`. Use it when asking Codex to create or update a user plugin inside `workspace/`; it keeps the implementation on the public WPP contract and runs the CLI validation loop.

## Example

Open `examples/simple-widget` from the directory picker. It demonstrates an `external-module` renderer that reads `sampleData` and renders a compact tile widget.
