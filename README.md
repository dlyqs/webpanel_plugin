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
pnpm --dir tools/wpp-dev-studio dev
```

## Project Layout

```text
wpp-dev-studio/
  .codex/skills/wpp-plugin-builder/  Codex skill for creating local WPP plugins
  examples/simple-widget/            Reference plugin that should stay distributable
  scripts/wpp-plugin.mjs             CLI validator and packer
  src/                               Studio UI and preview runtime
  workspace/                         Local user plugin work area, ignored by git
```

Put plugins you are actively developing under `workspace/<plugin-id>/`. The directory is intentionally present in the repo, but its contents are ignored so local user plugins do not become part of the studio distribution.

## Local Workflow

1. Create or copy a plugin into `workspace/<plugin-id>/`.
2. Validate it with `pnpm run wpp:validate -- workspace/<plugin-id>`.
3. Choose the plugin directory in the studio.
4. Enter a source URL and run `main/index.js`, or switch to Manual JSON and edit a `sampleData` test case.
5. Preview the plugin renderer in the simulated WebPanel tile.
6. Use browser DevTools or the studio console to debug renderer output.
7. Resize the simulated tile with the size controls or the tile resize handle.
8. Package the directory as `<plugin-id>.wpp`.

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
  render({ root, manifest, sampleData, host }) {
    host.log('render', manifest.id);
    root.innerHTML = `<h1>${manifest.name}</h1>`;
  }
};
```

The preview context contains:

- `root`: the tile root element.
- `manifest`: normalized manifest metadata.
- `sampleData`: the main output in Main Output mode, or the selected JSON test case in Manual JSON mode.
- `data`: alias for `sampleData`.
- `tile`: current simulated tile width and height in pixels.
- `host.log(...)`, `host.warn(...)`: messages forwarded to the studio console.
- `host.setTitle(title)`: updates the simulated tile title.
- `host.setStatus(status)`: emits a status message to the studio console.

## Packaging

The browser packer creates a ZIP32 archive with `.wpp` extension. It excludes `.DS_Store`, `.wpp` files, `.git`, and `node_modules`. The output is downloaded locally and includes a SHA-256 digest in the UI.

## Runtime Boundary

Third-party plugins should use `runtime.type = "external-module"` while developing in WPP Dev Studio. The studio can preview and package that renderer contract today.

The current WebPanel desktop local install path still executes only controlled `builtin-adapter` packages shipped by the host app. A packaged `external-module` is therefore a public contract artifact for studio preview and future sandbox support, not proof that the current desktop app will execute arbitrary third-party JavaScript.

## Codex Skill

This project ships a local skill at `.codex/skills/wpp-plugin-builder/SKILL.md`. Use it when asking Codex to create or update a user plugin inside `workspace/`; it keeps the implementation on the public WPP contract and runs the CLI validation loop.

## Example

Open `examples/simple-widget` from the directory picker. It demonstrates an `external-module` renderer that reads `sampleData` and renders a compact tile widget.
