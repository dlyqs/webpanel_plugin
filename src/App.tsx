import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileJson,
  FolderOpen,
  Globe2,
  Maximize2,
  Package,
  Play,
  RefreshCw,
  SlidersHorizontal,
  TerminalSquare,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
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
import { executePluginMain, type PluginMainRuntimeResult } from './pluginMainRuntime';
import { getDefaultSampleCase, SAMPLE_CASES } from './sampleCases';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type DataMode = 'main' | 'manual';

interface TileSize {
  width: number;
  height: number;
}

const DEFAULT_TILE_SIZE: TileSize = {
  width: 560,
  height: 390,
};

const TILE_MIN_SIZE: TileSize = {
  width: 280,
  height: 220,
};

const TILE_MAX_SIZE: TileSize = {
  width: 820,
  height: 560,
};

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function inferSourceUrlFromHostPatterns(hostPatterns: string[]): string {
  const preferredPattern =
    hostPatterns.find((pattern) => pattern.includes('/') && !pattern.trim().startsWith('*.')) ??
    hostPatterns.find((pattern) => !pattern.trim().startsWith('*.')) ??
    hostPatterns[0] ??
    '';
  const stripped = preferredPattern
    .trim()
    .replace(/^\*\./, '')
    .replace(/\*+$/, '')
    .replace(/\/+$/, '');

  if (!stripped) {
    return '';
  }

  const withProtocol = /^https?:\/\//i.test(stripped) ? stripped : `https://${stripped}`;
  try {
    return new URL(withProtocol).toString();
  } catch {
    return '';
  }
}

function formatDuration(value: number): string {
  if (value < 1000) {
    return `${value} ms`;
  }
  return `${(value / 1000).toFixed(1)} s`;
}

function createBlankPreviewSrcDoc(message: string): string {
  return `<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;font-family:system-ui;color:#64748b;background:#f8fafc">${message}</body></html>`;
}

function App() {
  const directoryInputRef = useRef<HTMLInputElement | null>(null);
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const boardStageRef = useRef<HTMLDivElement | null>(null);
  const resizeStartRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const autoRunKeyRef = useRef<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [directory, setDirectory] = useState<LoadedPluginDirectory | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rendererUrl, setRendererUrl] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [previewTitle, setPreviewTitle] = useState('');
  const [logs, setLogs] = useState<PreviewLogMessage[]>([]);
  const [dataMode, setDataMode] = useState<DataMode>('main');
  const [sourceUrl, setSourceUrl] = useState('');
  const [mainBusy, setMainBusy] = useState(false);
  const [mainResult, setMainResult] = useState<PluginMainRuntimeResult | null>(null);
  const [mainError, setMainError] = useState<string | null>(null);
  const [sampleCaseId, setSampleCaseId] = useState(getDefaultSampleCase().id);
  const [sampleJson, setSampleJson] = useState(() => JSON.stringify(getDefaultSampleCase().data, null, 2));
  const [tileSize, setTileSize] = useState<TileSize>(DEFAULT_TILE_SIZE);
  const [packageBusy, setPackageBusy] = useState(false);
  const [packageResult, setPackageResult] = useState<PackagedPluginDirectory | null>(null);
  const [packageError, setPackageError] = useState<string | null>(null);

  const appendLog = useCallback((log: PreviewLogMessage) => {
    setLogs((current) => [log, ...current].slice(0, 80));
  }, []);

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
        appendLog({
          level: event.data.level,
          message: event.data.message,
          details: event.data.details,
          at: event.data.at,
        });
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
  }, [appendLog]);

  const selectedSampleCase = SAMPLE_CASES.find((item) => item.id === sampleCaseId) ?? getDefaultSampleCase();
  const parsedSample = useMemo(() => parseSampleData(sampleJson), [sampleJson]);
  const totalFileSize = useMemo(
    () => directory?.files.reduce((sum, entry) => sum + entry.size, 0) ?? 0,
    [directory],
  );
  const runtimeLabel = directory?.manifest.runtime?.type ?? 'external-module';
  const tileTitle = previewTitle || directory?.manifest.name || 'Plugin preview';
  const effectiveSampleData = dataMode === 'main' && mainResult ? mainResult.data : parsedSample.data;
  const tileStyle = useMemo<CSSProperties>(
    () => ({
      width: `${tileSize.width}px`,
      height: `${tileSize.height}px`,
    }),
    [tileSize.height, tileSize.width],
  );

  const previewSrcDoc = useMemo(() => {
    if (!directory || !rendererUrl) {
      return createBlankPreviewSrcDoc('Choose a plugin directory');
    }
    if (dataMode === 'manual' && parsedSample.error) {
      return createBlankPreviewSrcDoc('Sample data JSON is invalid');
    }
    if (dataMode === 'main' && mainError) {
      return createBlankPreviewSrcDoc('Main entry failed');
    }
    if (dataMode === 'main' && !mainResult) {
      return createBlankPreviewSrcDoc('Run main to generate tile data');
    }
    return buildPreviewSrcDoc({
      manifest: directory.manifest,
      rendererUrl,
      sampleData: effectiveSampleData,
      tile: tileSize,
    });
  }, [
    dataMode,
    directory,
    effectiveSampleData,
    mainError,
    mainResult,
    parsedSample.error,
    rendererUrl,
    previewVersion,
    tileSize,
  ]);

  const runMain = useCallback(async () => {
    if (!directory) {
      return;
    }
    if (parsedSample.error) {
      setMainError(parsedSample.error);
      return;
    }

    setDataMode('main');
    setMainBusy(true);
    setMainError(null);
    setMainResult(null);
    setLogs([]);
    try {
      const result = await executePluginMain({
        manifest: directory.manifest,
        mainSource: directory.mainSource,
        sourceUrl,
        sampleData: parsedSample.data,
        onLog: appendLog,
      });
      setMainResult(result);
      if (result.sourceUrl && result.sourceUrl !== sourceUrl) {
        setSourceUrl(result.sourceUrl);
      }
      setPreviewVersion((current) => current + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Main entry failed';
      setMainError(message);
      appendLog({
        level: 'error',
        message,
        at: new Date().toISOString(),
      });
    } finally {
      setMainBusy(false);
    }
  }, [appendLog, directory, parsedSample.data, parsedSample.error, sourceUrl]);

  useEffect(() => {
    if (!directory || dataMode !== 'main' || mainBusy || mainError) {
      return;
    }
    const autoRunKey = `${directory.rootName}:${directory.manifest.id}:${directory.manifest.version}`;
    if (autoRunKeyRef.current === autoRunKey) {
      return;
    }
    autoRunKeyRef.current = autoRunKey;
    void runMain();
  }, [dataMode, directory, mainBusy, mainError, runMain]);

  useEffect(() => {
    previewFrameRef.current?.contentWindow?.postMessage(
      {
        source: 'wpp-dev-studio-tile-size',
        tile: tileSize,
      },
      '*',
    );
  }, [tileSize]);

  const chooseDirectory = () => {
    directoryInputRef.current?.click();
  };

  const handleDirectoryChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files;
    setPackageResult(null);
    setPackageError(null);
    setLogs([]);
    setPreviewVersion((current) => current + 1);
    autoRunKeyRef.current = null;
    if (!files || files.length === 0) {
      return;
    }

    setLoadState('loading');
    setLoadError(null);
    try {
      const loaded = await readPluginDirectory(files);
      setDataMode('main');
      setSourceUrl(inferSourceUrlFromHostPatterns(loaded.manifest.hostPatterns));
      setMainResult(null);
      setMainError(null);
      setDirectory(loaded);
      setLoadState('ready');
    } catch (error) {
      setDirectory(null);
      setSourceUrl('');
      setMainResult(null);
      setMainError(null);
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
    setMainResult(null);
    setMainError(null);
    setPreviewVersion((current) => current + 1);
    setLogs([]);
  };

  const reloadPreview = () => {
    if (dataMode === 'main' && directory) {
      void runMain();
      return;
    }
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

  const setPresetTileSize = (nextSize: TileSize) => {
    setTileSize({
      width: clamp(nextSize.width, TILE_MIN_SIZE.width, TILE_MAX_SIZE.width),
      height: clamp(nextSize.height, TILE_MIN_SIZE.height, TILE_MAX_SIZE.height),
    });
  };

  const beginTileResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    resizeStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      width: tileSize.width,
      height: tileSize.height,
    };

    const onPointerMove = (pointerEvent: PointerEvent) => {
      const start = resizeStartRef.current;
      if (!start) {
        return;
      }
      const stageRect = boardStageRef.current?.getBoundingClientRect();
      const maxWidth = Math.min(TILE_MAX_SIZE.width, Math.max(TILE_MIN_SIZE.width, (stageRect?.width ?? 900) - 52));
      const maxHeight = Math.min(TILE_MAX_SIZE.height, Math.max(TILE_MIN_SIZE.height, (stageRect?.height ?? 600) - 52));
      setTileSize({
        width: Math.round(clamp(start.width + pointerEvent.clientX - start.x, TILE_MIN_SIZE.width, maxWidth)),
        height: Math.round(clamp(start.height + pointerEvent.clientY - start.y, TILE_MIN_SIZE.height, maxHeight)),
      });
    };

    const onPointerUp = () => {
      resizeStartRef.current = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
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
              <Globe2 size={18} />
              <h2>Runtime</h2>
            </div>
            <div className="mode-switch" role="group" aria-label="Preview data source">
              <button
                type="button"
                className={dataMode === 'main' ? 'is-active' : ''}
                onClick={() => setDataMode('main')}
              >
                Main Output
              </button>
              <button
                type="button"
                className={dataMode === 'manual' ? 'is-active' : ''}
                onClick={() => setDataMode('manual')}
              >
                Manual JSON
              </button>
            </div>
            <label className="field-label" htmlFor="source-url">
              Source URL
            </label>
            <input
              id="source-url"
              className="text-input"
              type="url"
              value={sourceUrl}
              onChange={(event) => {
                setSourceUrl(event.currentTarget.value);
                setMainResult(null);
                setMainError(null);
              }}
              placeholder="https://example.com/page"
            />
            <button type="button" className="wide-button" onClick={runMain} disabled={!directory || mainBusy}>
              <Play size={16} />
              {mainBusy ? 'Running Main' : 'Run Main'}
            </button>
            {dataMode === 'main' && mainResult && (
              <p className="state-line">
                <CheckCircle2 size={14} />
                Main output ready in {formatDuration(mainResult.durationMs)}
              </p>
            )}
            {dataMode === 'main' && mainError && (
              <p className="state-line is-error">
                <AlertTriangle size={14} />
                {mainError}
              </p>
            )}
            {dataMode === 'main' && !mainResult && !mainError && !mainBusy && (
              <p className="state-line">Renderer receives main output as sampleData.</p>
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
              onChange={(event) => {
                setSampleJson(event.currentTarget.value);
                setMainResult(null);
                setMainError(null);
              }}
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
          <div className="board-stage" ref={boardStageRef}>
            <div className="grid-lines" />
            <article className="sim-tile" style={tileStyle}>
              <header className="sim-tile-header">
                <div>
                  <strong>{tileTitle}</strong>
                  <span>{directory?.manifest.hostPatterns[0] ?? 'local preview'}</span>
                </div>
                <span className="route-pill">{runtimeLabel}</span>
              </header>
              <div className="sim-tile-body">
                <iframe
                  ref={previewFrameRef}
                  key={`${directory?.manifest.id ?? 'empty'}:${previewVersion}:${rendererUrl ?? 'none'}`}
                  title="WPP plugin preview"
                  className="preview-frame"
                  srcDoc={previewSrcDoc}
                  sandbox="allow-scripts allow-same-origin allow-popups"
                />
              </div>
              <button
                type="button"
                className="tile-resize-handle"
                onPointerDown={beginTileResize}
                aria-label="Resize tile"
              >
                <Maximize2 size={13} />
              </button>
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

          <section className="panel-section">
            <div className="section-heading">
              <SlidersHorizontal size={18} />
              <h2>Tile Size</h2>
            </div>
            <div className="size-readout">
              <strong>{tileSize.width}px</strong>
              <span>x</span>
              <strong>{tileSize.height}px</strong>
            </div>
            <label className="field-label" htmlFor="tile-width">
              Width
            </label>
            <input
              id="tile-width"
              className="range-input"
              type="range"
              min={TILE_MIN_SIZE.width}
              max={TILE_MAX_SIZE.width}
              value={tileSize.width}
              onChange={(event) =>
                setTileSize((current) => ({
                  ...current,
                  width: Number(event.currentTarget.value),
                }))
              }
            />
            <label className="field-label" htmlFor="tile-height">
              Height
            </label>
            <input
              id="tile-height"
              className="range-input"
              type="range"
              min={TILE_MIN_SIZE.height}
              max={TILE_MAX_SIZE.height}
              value={tileSize.height}
              onChange={(event) =>
                setTileSize((current) => ({
                  ...current,
                  height: Number(event.currentTarget.value),
                }))
              }
            />
            <div className="size-presets">
              <button type="button" onClick={() => setPresetTileSize({ width: 360, height: 260 })}>
                Small
              </button>
              <button type="button" onClick={() => setPresetTileSize(DEFAULT_TILE_SIZE)}>
                Medium
              </button>
              <button type="button" onClick={() => setPresetTileSize({ width: 720, height: 500 })}>
                Large
              </button>
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
