import type { SitePluginManifest } from './pluginManifest';
import type { PreviewLogMessage } from './pluginPreview';

export interface ExecutePluginMainOptions {
  manifest: SitePluginManifest;
  mainSource: string;
  sourceUrl: string;
  sampleData: unknown;
  onLog?: (log: PreviewLogMessage) => void;
}

export interface PluginMainRuntimeResult {
  data: unknown;
  sourceUrl: string;
  durationMs: number;
  at: string;
}

interface HostFetchPayload {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

interface RunnablePluginMain {
  activate?: (context: PluginMainContext) => unknown | Promise<unknown>;
  resolve?: (context: PluginMainContext) => unknown | Promise<unknown>;
  fetch?: (context: PluginMainContext) => unknown | Promise<unknown>;
  default?: RunnablePluginMain | ((context: PluginMainContext) => unknown | Promise<unknown>);
}

interface PluginMainContext {
  manifest: SitePluginManifest;
  sourceUrl: string;
  sampleData: unknown;
  request: {
    operation: 'preview';
    url: string;
  };
  host: PluginMainHost;
}

interface PluginMainHost {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  setStatus: (status: unknown) => void;
  fetch: (url: string, init?: RequestInit) => Promise<HostFetchResponse>;
  fetchText: (url: string, init?: RequestInit) => Promise<string>;
  fetchJson: (url: string, init?: RequestInit) => Promise<unknown>;
}

class HostFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  headers: Headers;
  private readonly body: string;

  constructor(payload: HostFetchPayload) {
    this.ok = payload.ok;
    this.status = payload.status;
    this.statusText = payload.statusText;
    this.url = payload.url;
    this.headers = new Headers(payload.headers);
    this.body = payload.body;
  }

  async text(): Promise<string> {
    return this.body;
  }

  async json(): Promise<unknown> {
    return JSON.parse(this.body);
  }
}

function serializeLogPart(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeSourceUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  try {
    return new URL(trimmed).toString();
  } catch {
    throw new Error(`Source URL is invalid: ${trimmed}`);
  }
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key, value]));
  }
  return Object.fromEntries(
    Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function normalizeBody(body: BodyInit | null | undefined): string | undefined {
  if (typeof body === 'undefined' || body === null) {
    return undefined;
  }
  if (typeof body === 'string') {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  throw new Error('Dev Studio fetch proxy only supports string and URLSearchParams request bodies.');
}

async function fetchThroughStudioProxy(url: string, init: RequestInit | undefined): Promise<HostFetchResponse> {
  const response = await window.fetch('/__wpp_dev_studio/fetch', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      url,
      init: {
        method: init?.method ?? 'GET',
        headers: normalizeHeaders(init?.headers),
        body: normalizeBody(init?.body),
      },
    }),
  });

  const payload = (await response.json()) as HostFetchPayload | { error?: string };
  if (!response.ok) {
    throw new Error('error' in payload && payload.error ? payload.error : `Fetch proxy failed with ${response.status}`);
  }
  return new HostFetchResponse(payload as HostFetchPayload);
}

async function fetchFromBrowser(url: string, init: RequestInit | undefined): Promise<HostFetchResponse> {
  const response = await window.fetch(url, init);
  return new HostFetchResponse({
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    url: response.url,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text(),
  });
}

async function hostFetch(url: string, init?: RequestInit): Promise<HostFetchResponse> {
  try {
    return await fetchThroughStudioProxy(url, init);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return fetchFromBrowser(url, init);
    }
    throw error;
  }
}

function unwrapMainExport(value: unknown): RunnablePluginMain | ((context: PluginMainContext) => unknown | Promise<unknown>) {
  const candidate = value as RunnablePluginMain;
  if (candidate && typeof candidate === 'object' && candidate.default) {
    return candidate.default;
  }
  return value as RunnablePluginMain;
}

function getSourceUrlFromValue(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const sourceUrl = record.sourceUrl ?? record.url;
  return typeof sourceUrl === 'string' && sourceUrl.trim() ? sourceUrl.trim() : null;
}

async function resolveMainData(
  exported: RunnablePluginMain | ((context: PluginMainContext) => unknown | Promise<unknown>),
  context: PluginMainContext,
): Promise<unknown> {
  if (typeof exported === 'function') {
    return exported(context);
  }

  let activated: unknown;
  if (typeof exported.activate === 'function') {
    activated = await exported.activate(context);
    const activationSourceUrl = getSourceUrlFromValue(activated);
    if (activationSourceUrl && !context.sourceUrl) {
      context.sourceUrl = activationSourceUrl;
      context.request.url = activationSourceUrl;
    }
  }

  if (typeof exported.resolve === 'function') {
    return exported.resolve(context);
  }

  if (typeof exported.fetch === 'function') {
    return exported.fetch(context);
  }

  if (activated && typeof activated === 'object') {
    const runnable = activated as RunnablePluginMain;
    if (typeof runnable.resolve === 'function') {
      return runnable.resolve(context);
    }
    if (typeof runnable.fetch === 'function') {
      return runnable.fetch(context);
    }
  }

  return activated ?? exported;
}

export async function executePluginMain({
  manifest,
  mainSource,
  sourceUrl,
  sampleData,
  onLog,
}: ExecutePluginMainOptions): Promise<PluginMainRuntimeResult> {
  const startedAt = performance.now();
  const normalizedSourceUrl = normalizeSourceUrl(sourceUrl);

  const emit = (level: PreviewLogMessage['level'], message: string, details?: unknown) => {
    onLog?.({
      level,
      message,
      details,
      at: new Date().toISOString(),
    });
  };

  const fetchWithPermission: PluginMainHost['fetch'] = async (url, init) => {
    if (!manifest.permissions.includes('network')) {
      throw new Error('manifest.permissions must include "network" to fetch remote URLs.');
    }
    emit('info', `main fetch ${url}`);
    const response = await hostFetch(url, init);
    emit(response.ok ? 'info' : 'warn', `main fetch ${response.status} ${response.statusText}`, {
      url: response.url,
    });
    return response;
  };

  const host: PluginMainHost = {
    log: (...args) => emit('info', args.map(serializeLogPart).join(' '), args),
    warn: (...args) => emit('warn', args.map(serializeLogPart).join(' '), args),
    setStatus: (status) => emit('info', serializeLogPart(status), { status }),
    fetch: fetchWithPermission,
    fetchText: async (url, init) => {
      const response = await fetchWithPermission(url, init);
      return response.text();
    },
    fetchJson: async (url, init) => {
      const response = await fetchWithPermission(url, init);
      return response.json();
    },
  };

  const context: PluginMainContext = {
    manifest,
    sourceUrl: normalizedSourceUrl,
    sampleData,
    request: {
      operation: 'preview',
      url: normalizedSourceUrl,
    },
    host,
  };

  const module = { exports: {} as unknown };
  const exports = module.exports;
  const requireUnavailable = () => {
    throw new Error('Dev Studio main preview does not support require(). Bundle dependencies into main/index.js.');
  };

  try {
    const runMain = new Function(
      'module',
      'exports',
      'context',
      'host',
      'fetch',
      'require',
      'URL',
      'URLSearchParams',
      'setTimeout',
      'clearTimeout',
      `"use strict";\n${mainSource}\n//# sourceURL=wpp-main:${manifest.id}`,
    ) as (
      module: { exports: unknown },
      exports: unknown,
      context: PluginMainContext,
      host: PluginMainHost,
      fetch: PluginMainHost['fetch'],
      require: () => never,
      URL: typeof window.URL,
      URLSearchParams: typeof window.URLSearchParams,
      setTimeout: typeof window.setTimeout,
      clearTimeout: typeof window.clearTimeout,
    ) => void;

    runMain(
      module,
      exports,
      context,
      host,
      fetchWithPermission,
      requireUnavailable,
      window.URL,
      window.URLSearchParams,
      window.setTimeout,
      window.clearTimeout,
    );
  } catch (error) {
    throw new Error(
      `main/index.js failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const exported = unwrapMainExport(module.exports);
  const data = await resolveMainData(exported, context);
  const dataSourceUrl = getSourceUrlFromValue(data);
  if (dataSourceUrl) {
    context.sourceUrl = dataSourceUrl;
    context.request.url = dataSourceUrl;
  }
  emit('ready', 'main ready', {
    pluginId: manifest.id,
    sourceUrl: context.sourceUrl,
  });

  return {
    data,
    sourceUrl: context.sourceUrl,
    durationMs: Math.round(performance.now() - startedAt),
    at: new Date().toISOString(),
  };
}
