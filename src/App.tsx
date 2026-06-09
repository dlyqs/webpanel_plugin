import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileJson,
  FolderOpen,
  Package,
  Play,
  RefreshCw,
  TerminalSquare,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  downloadPackagedPlugin,
  packagePluginDirectory,
  readPluginDirectory,
  type LoadedPluginDirectory,
  type PackagedPluginDirectory,
} from './pluginDirectory';
import {
  buildPreviewSrcDoc,
  isPreviewLogMessage,
  type PreviewLogMessage,
} from './pluginPreview';
import { getDefaultSampleCase, SAMPLE_CASES } from './sampleCases';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function parseSampleData(value: string): { data: unknown; error: string | null } {
  try {
    return {
      data: JSON.parse(value),
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Invalid JSON',
    };
  }
}

function createBlankPreviewSrcDoc(message: string): string {
  return `<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;font-family:system-ui;color:#64748b;background:#f8fafc">${message}</body></html>`;
}

function App() {
  const directoryInputRef = useRef<HTMLInputElement | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [directory, setDirectory] = useState<LoadedPluginDirectory | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rendererUrl, setRendererUrl] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [previewTitle, setPreviewTitle] = useState('');
  const [logs, setLogs] = useState<PreviewLogMessage[]>([]);
  const [sampleCaseId, setSampleCaseId] = useState(getDefaultSampleCase().id);
  const [sampleJson, setSampleJson] = useState(() => JSON.stringify(getDefaultSampleCase().data, null, 2));
  const [packageBusy, setPackageBusy] = useState(false);
  const [packageResult, setPackageResult] = useState<PackagedPluginDirectory | null>(null);
  const [packageError, setPackageError] = useState<string | null>(null);

  useEffect(() => {
    directoryInputRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  useEffect(() => {
    if (!directory) {
      setRendererUrl(null);
      return undefined;
    }

    const url = URL.createObjectURL(
      new Blob([directory.rendererSource], {
        type: 'text/javascript',
      }),
    );
    setRendererUrl(url);
    setLogs([]);
    setPreviewTitle('');
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [directory]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (isPreviewLogMessage(event.data)) {
        setLogs((current) => [
          {
            level: event.data.level,
            message: event.data.message,
            details: event.data.details,
            at: event.data.at,
          },
          ...current,
        ].slice(0, 80));
        return;
      }

      if (
        typeof event.data === 'object' &&
        event.data !== null &&
        (event.data as Record<string, unknown>).source === 'wpp-dev-studio-title'
      ) {
        setPreviewTitle(String((event.data as Record<string, unknown>).title || ''));
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const selectedSampleCase = SAMPLE_CASES.find((item) => item.id === sampleCaseId) ?? getDefaultSampleCase();
  const parsedSample = useMemo(() => parseSampleData(sampleJson), [sampleJson]);
  const totalFileSize = useMemo(
    () => directory?.files.reduce((sum, entry) => sum + entry.size, 0) ?? 0,
    [directory],
  );
  const runtimeLabel = directory?.manifest.runtime?.type ?? 'external-module';
  const tileTitle = previewTitle || directory?.manifest.name || 'Plugin preview';

  const previewSrcDoc = useMemo(() => {
    if (!directory || !rendererUrl) {
      return createBlankPreviewSrcDoc('Choose a plugin directory');
    }
    if (parsedSample.error) {
      return createBlankPreviewSrcDoc('Sample data JSON is invalid');
    }
    return buildPreviewSrcDoc({
      manifest: directory.manifest,
      rendererUrl,
      sampleData: parsedSample.data,
    });
  }, [directory, parsedSample.data, parsedSample.error, rendererUrl, previewVersion]);

  const chooseDirectory = () => {
    directoryInputRef.current?.click();
  };

  const handleDirectoryChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files;
    setPackageResult(null);
    setPackageError(null);
    setLogs([]);
    setPreviewVersion((current) => current + 1);
    if (!files || files.length === 0) {
      return;
    }

    setLoadState('loading');
    setLoadError(null);
    try {
      const loaded = await readPluginDirectory(files);
      setDirectory(loaded);
      setLoadState('ready');
    } catch (error) {
      setDirectory(null);
      setLoadState('error');
      setLoadError(error instanceof Error ? error.message : 'Failed to load plugin directory');
    } finally {
      event.currentTarget.value = '';
    }
  };

  const handleSampleCaseChange = (nextId: string) => {
    const nextCase = SAMPLE_CASES.find((item) => item.id === nextId) ?? getDefaultSampleCase();
    setSampleCaseId(nextCase.id);
    setSampleJson(JSON.stringify(nextCase.data, null, 2));
    setPreviewVersion((current) => current + 1);
    setLogs([]);
  };

  const reloadPreview = () => {
    setPreviewVersion((current) => current + 1);
    setLogs([]);
  };

  const openPreviewWindow = () => {
    const win = window.open('', '_blank');
    if (!win) {
      return;
    }
    win.document.open();
    win.document.write(previewSrcDoc);
    win.document.close();
  };

  const packageDirectory = async () => {
    if (!directory) {
      return;
    }
    setPackageBusy(true);
    setPackageError(null);
    try {
      const result = await packagePluginDirectory(directory);
      setPackageResult(result);
      downloadPackagedPlugin(result);
    } catch (error) {
      setPackageError(error instanceof Error ? error.message : 'Packaging failed');
    } finally {
      setPackageBusy(false);
    }
  };

  return (
    <main className="studio-shell">
      <header className="studio-topbar">
        <div>
          <p className="eyebrow">WebPanel</p>
          <h1>WPP Dev Studio</h1>
        </div>
        <div className="topbar-actions">
          <button type="button" className="ghost-button" onClick={reloadPreview} disabled={!directory}>
            <RefreshCw size={16} />
            Reload
          </button>
          <button type="button" className="ghost-button" onClick={openPreviewWindow} disabled={!directory}>
            <ExternalLink size={16} />
            New Tab
          </button>
          <button type="button" className="primary-button" onClick={packageDirectory} disabled={!directory || packageBusy}>
            <Package size={16} />
            {packageBusy ? 'Packaging' : 'Package .wpp'}
          </button>
        </div>
      </header>

      <section className="studio-grid">
        <aside className="studio-panel left-panel">
          <input
            ref={directoryInputRef}
            className="hidden-input"
            type="file"
            multiple
            onChange={handleDirectoryChange}
          />

          <section className="panel-section">
            <div className="section-heading">
              <FolderOpen size={18} />
              <h2>Plugin Directory</h2>
            </div>
            <button type="button" className="wide-button" onClick={chooseDirectory}>
              <FolderOpen size={16} />
              Choose Directory
            </button>
            {loadState === 'loading' && <p className="state-line">Reading directory...</p>}
            {loadState === 'error' && loadError && (
              <p className="state-line is-error">
                <AlertTriangle size={14} />
                {loadError}
              </p>
            )}
            {directory && (
              <div className="manifest-card">
                <div className="manifest-title-row">
                  <FileJson size={16} />
                  <strong>{directory.manifest.name}</strong>
                </div>
                <dl>
                  <div>
                    <dt>ID</dt>
                    <dd>{directory.manifest.id}</dd>
                  </div>
                  <div>
                    <dt>Version</dt>
                    <dd>{directory.manifest.version}</dd>
                  </div>
                  <div>
                    <dt>Runtime</dt>
                    <dd>{runtimeLabel}</dd>
                  </div>
                  <div>
                    <dt>Files</dt>
                    <dd>
                      {directory.files.length} / {formatBytes(totalFileSize)}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </section>

          <section className="panel-section">
            <div className="section-heading">
              <Play size={18} />
              <h2>Test Case</h2>
            </div>
            <label className="field-label" htmlFor="sample-case">
              Scenario
            </label>
            <select
              id="sample-case"
              className="select-input"
              value={sampleCaseId}
              onChange={(event) => handleSampleCaseChange(event.currentTarget.value)}
            >
              {SAMPLE_CASES.map((sampleCase) => (
                <option key={sampleCase.id} value={sampleCase.id}>
                  {sampleCase.label}
                </option>
              ))}
            </select>
            <p className="state-line">{selectedSampleCase.description}</p>
            <label className="field-label" htmlFor="sample-json">
              sampleData
            </label>
            <textarea
              id="sample-json"
              className={`json-editor ${parsedSample.error ? 'is-invalid' : ''}`}
              spellCheck={false}
              value={sampleJson}
              onChange={(event) => setSampleJson(event.currentTarget.value)}
            />
            {parsedSample.error && (
              <p className="state-line is-error">
                <AlertTriangle size={14} />
                {parsedSample.error}
              </p>
            )}
          </section>

          <section className="panel-section">
            <div className="section-heading">
              <Download size={18} />
              <h2>Package</h2>
            </div>
            <button type="button" className="wide-button accent" onClick={packageDirectory} disabled={!directory || packageBusy}>
              <Package size={16} />
              {packageBusy ? 'Packaging' : 'Download .wpp'}
            </button>
            {packageResult && (
              <div className="package-result">
                <CheckCircle2 size={16} />
                <div>
                  <strong>{packageResult.fileName}</strong>
                  <span>{packageResult.sha256}</span>
                </div>
              </div>
            )}
            {packageError && (
              <p className="state-line is-error">
                <AlertTriangle size={14} />
                {packageError}
              </p>
            )}
          </section>
        </aside>

        <section className="board-zone" aria-label="Plugin preview board">
          <div className="board-stage">
            <div className="grid-lines" />
            <article className="sim-tile">
              <header className="sim-tile-header">
                <div>
                  <strong>{tileTitle}</strong>
                  <span>{directory?.manifest.hostPatterns[0] ?? 'local preview'}</span>
                </div>
                <span className="route-pill">{runtimeLabel}</span>
              </header>
              <div className="sim-tile-body">
                <iframe
                  key={`${directory?.manifest.id ?? 'empty'}:${previewVersion}:${rendererUrl ?? 'none'}`}
                  title="WPP plugin preview"
                  className="preview-frame"
                  srcDoc={previewSrcDoc}
                  sandbox="allow-scripts allow-same-origin allow-popups"
                />
              </div>
            </article>
          </div>
        </section>

        <aside className="studio-panel right-panel">
          <section className="panel-section">
            <div className="section-heading">
              <FileJson size={18} />
              <h2>Manifest</h2>
            </div>
            {directory ? (
              <div className="runtime-list">
                <div>
                  <span>API</span>
                  <strong>{directory.manifest.pluginApiVersion}</strong>
                </div>
                <div>
                  <span>Renderer</span>
                  <strong>{directory.manifest.entry.renderer}</strong>
                </div>
                <div>
                  <span>Main</span>
                  <strong>{directory.manifest.entry.main}</strong>
                </div>
                <div>
                  <span>Permissions</span>
                  <strong>{directory.manifest.permissions.join(', ')}</strong>
                </div>
              </div>
            ) : (
              <p className="state-line">No manifest loaded.</p>
            )}
            {directory?.warnings.map((warning) => (
              <p className="warning-line" key={warning}>
                <AlertTriangle size={14} />
                {warning}
              </p>
            ))}
          </section>

          <section className="panel-section files-section">
            <div className="section-heading">
              <FileJson size={18} />
              <h2>Package Files</h2>
            </div>
            <div className="file-list">
              {directory?.files.slice(0, 12).map((entry) => (
                <div className="file-row" key={entry.path}>
                  <span>{entry.path}</span>
                  <em>{formatBytes(entry.size)}</em>
                </div>
              ))}
              {directory && directory.files.length > 12 && (
                <div className="file-row is-muted">
                  <span>+{directory.files.length - 12} more</span>
                  <em />
                </div>
              )}
              {!directory && <p className="state-line">No files selected.</p>}
            </div>
          </section>

          <section className="panel-section console-section">
            <div className="section-heading">
              <TerminalSquare size={18} />
              <h2>Console</h2>
            </div>
            <div className="console-log">
              {logs.length === 0 ? (
                <p className="console-empty">No preview logs.</p>
              ) : (
                logs.map((log, index) => (
                  <div className={`console-row is-${log.level}`} key={`${log.at}:${index}`}>
                    <time>{formatTime(log.at)}</time>
                    <span>{log.level}</span>
                    <p>{log.message}</p>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

export default App;
