export default {
  render({ root, manifest, sampleData, theme, host }) {
    const title = sampleData?.title || manifest.name;
    const text = sampleData?.text || 'Edit sampleData to preview your own plugin state.';
    const items = Array.isArray(sampleData?.items) ? sampleData.items : [];
    const outcomes = Array.isArray(sampleData?.outcomes) ? sampleData.outcomes : [];

    host.setTitle(title);
    host.log('render', { pluginId: manifest.id, title, theme });

    root.innerHTML = `
      <style>
        .simple-widget {
          height: 100%;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr);
          gap: 14px;
          padding: 18px;
          color: var(--wpp-color-text);
          background: var(--wpp-color-background);
        }
        .simple-widget header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }
        .simple-widget h1 {
          margin: 0;
          font-size: 20px;
          line-height: 1.2;
        }
        .simple-widget .badge {
          flex: 0 0 auto;
          padding: 5px 8px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--wpp-color-accent) 14%, transparent);
          color: var(--wpp-color-accent);
          font-size: 12px;
          font-weight: 700;
        }
        .simple-widget .body {
          min-height: 0;
          overflow: auto;
          display: grid;
          align-content: start;
          gap: 10px;
        }
        .simple-widget p {
          margin: 0;
          color: var(--wpp-color-muted);
          line-height: 1.55;
        }
        .simple-widget .row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
          padding: 10px;
          border: 1px solid var(--wpp-color-border);
          border-radius: 8px;
          background: var(--wpp-color-surface);
        }
        .simple-widget strong,
        .simple-widget span {
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .simple-widget .row p {
          grid-column: 1 / -1;
        }
      </style>
      <article class="simple-widget">
        <header>
          <div>
            <h1>${escapeHtml(title)}</h1>
            <p>${escapeHtml(sampleData?.url || 'local://sample')}</p>
          </div>
          <span class="badge">${escapeHtml(manifest.version)}</span>
        </header>
        <section class="body">
          <p>${escapeHtml(text)}</p>
          ${outcomes.map((item) => `
            <div class="row">
              <strong>${escapeHtml(item.label || 'Outcome')}</strong>
              <span>${escapeHtml(String(item.price ?? item.volume ?? ''))}</span>
            </div>
          `).join('')}
          ${items.map((item) => `
            <div class="row">
              <strong>${escapeHtml(item.author || item.id || 'Item')}</strong>
              <span>${escapeHtml(item.timestamp || '')}</span>
              <p>${escapeHtml(item.text || '')}</p>
            </div>
          `).join('')}
        </section>
      </article>
    `;
  },
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
