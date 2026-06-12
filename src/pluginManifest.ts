export type SitePluginPermission = 'cookies' | 'executeScript' | 'network' | 'openWindow' | 'terminal';
export type SitePluginSurface = 'site' | 'utility';

export type SitePluginRuntimeType = 'builtin-adapter' | 'external-module';

export interface SitePluginRuntimeDescriptor {
  type: SitePluginRuntimeType;
  adapter?: string;
}

export interface SitePluginMarketplaceMetadata {
  tags?: string[];
  highlights?: string[];
}

export interface SitePluginManifest {
  id: string;
  name: string;
  version: string;
  pluginApiVersion: string;
  description: string;
  surface?: SitePluginSurface;
  author?: string;
  hostPatterns: string[];
  defaultLaunchUrl?: string;
  permissions: SitePluginPermission[];
  entry: {
    renderer: string;
    main: string;
  };
  runtime?: SitePluginRuntimeDescriptor;
  marketplace?: SitePluginMarketplaceMetadata;
}

export interface ManifestValidationResult {
  manifest: SitePluginManifest;
  warnings: string[];
}

const PLUGIN_API_VERSION = '1.0.0';
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const SUPPORTED_PERMISSIONS = new Set<SitePluginPermission>([
  'cookies',
  'executeScript',
  'network',
  'openWindow',
  'terminal',
]);
const MAIN_APP_BUILTIN_ADAPTERS = new Set(['x-timeline', 'polymarket-event', 'terminal', 'clock', 'calendar']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`manifest.json is missing ${key}`);
  }
  return value.trim();
}

function readRequiredStringFromKeys(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  throw new Error(`manifest.json is missing ${keys[0]}`);
}

function readStringArray(record: Record<string, unknown>, key: string, options: { allowEmpty?: boolean } = {}): string[] {
  const value = record[key];
  if (!Array.isArray(value) || (!options.allowEmpty && value.length === 0)) {
    throw new Error(`manifest.json is missing ${key}`);
  }
  return value.map((item) => {
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw new Error(`manifest.json ${key} must be a non-empty string array`);
    }
    return item.trim();
  });
}

function readStringArrayFromKeys(
  record: Record<string, unknown>,
  keys: string[],
  options: { allowEmpty?: boolean } = {},
): string[] {
  for (const key of keys) {
    if (Array.isArray(record[key]) && (options.allowEmpty || record[key].length > 0)) {
      return readStringArray(record, key, options);
    }
  }
  throw new Error(`manifest.json is missing ${keys[0]}`);
}

function readSurface(record: Record<string, unknown>): SitePluginSurface | undefined {
  if (typeof record.surface === 'undefined') {
    return undefined;
  }
  if (record.surface !== 'site' && record.surface !== 'utility') {
    throw new Error('manifest.json surface must be "site" or "utility"');
  }
  return record.surface;
}

function readDefaultLaunchUrl(record: Record<string, unknown>, surface: SitePluginSurface): string | undefined {
  const rawValue = typeof record.defaultLaunchUrl === 'string' ? record.defaultLaunchUrl : record.default_launch_url;
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    if (surface === 'utility') {
      return undefined;
    }
    throw new Error('manifest.json is missing default_launch_url');
  }
  const value = rawValue.trim();
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
    return parsed.toString();
  } catch {
    throw new Error('manifest.json default_launch_url must be a valid http/https URL');
  }
}

function normalizePackageRelativePath(value: string, key: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/');
  if (!normalized || parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw new Error(`manifest.json ${key} must be a valid relative path`);
  }
  return parts.join('/');
}

function readEntry(record: Record<string, unknown>): SitePluginManifest['entry'] {
  const value = record.entry;
  if (!isRecord(value)) {
    throw new Error('manifest.json is missing entry');
  }
  return {
    renderer: normalizePackageRelativePath(readRequiredString(value, 'renderer'), 'entry.renderer'),
    main: normalizePackageRelativePath(readRequiredString(value, 'main'), 'entry.main'),
  };
}

function readRuntime(record: Record<string, unknown>): SitePluginRuntimeDescriptor | undefined {
  const value = record.runtime;
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error('manifest.json runtime must be an object');
  }

  const type = readRequiredString(value, 'type');
  if (type !== 'builtin-adapter' && type !== 'external-module') {
    throw new Error(`Unsupported runtime.type: ${type}`);
  }

  const adapter = typeof value.adapter === 'string' ? value.adapter.trim() : undefined;
  if (type === 'builtin-adapter' && !adapter) {
    throw new Error('builtin-adapter plugins must declare runtime.adapter');
  }

  return {
    type,
    adapter,
  };
}

function readMarketplace(record: Record<string, unknown>): SitePluginMarketplaceMetadata | undefined {
  const value = record.marketplace;
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error('manifest.json marketplace must be an object');
  }

  const tags = Array.isArray(value.tags)
    ? value.tags
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    : undefined;
  const highlights = Array.isArray(value.highlights)
    ? value.highlights
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    : undefined;

  return {
    tags,
    highlights,
  };
}

export function validateSitePluginManifest(value: unknown): ManifestValidationResult {
  if (!isRecord(value)) {
    throw new Error('manifest.json must be an object');
  }

  const id = readRequiredString(value, 'id');
  if (!PLUGIN_ID_PATTERN.test(id)) {
    throw new Error(`Invalid plugin id: ${id}`);
  }

  const pluginApiVersion = readRequiredStringFromKeys(value, ['pluginApiVersion', 'plugin_api_version']);
  if (pluginApiVersion !== PLUGIN_API_VERSION) {
    throw new Error(`Incompatible plugin API version: ${pluginApiVersion}`);
  }

  const permissions = readStringArray(value, 'permissions', { allowEmpty: true }).map((permission) => {
    if (!SUPPORTED_PERMISSIONS.has(permission as SitePluginPermission)) {
      throw new Error(`Unsupported plugin permission: ${permission}`);
    }
    return permission as SitePluginPermission;
  });

  const runtime = readRuntime(value);
  const surface = readSurface(value) ?? 'site';
  const hostPatterns = readStringArrayFromKeys(value, ['hostPatterns', 'host_patterns'], {
    allowEmpty: surface === 'utility',
  });
  const defaultLaunchUrl = readDefaultLaunchUrl(value, surface);
  const warnings: string[] = [];
  if (!runtime) {
    warnings.push('manifest.runtime is missing; the studio previews it as external-module.');
  }
  if (runtime?.type === 'builtin-adapter') {
    if (runtime.adapter !== id) {
      warnings.push('builtin-adapter runtime.adapter should match manifest.id.');
    }
    if (!MAIN_APP_BUILTIN_ADAPTERS.has(runtime.adapter ?? '')) {
      warnings.push('The main app only ships controlled built-in adapters; use external-module for third-party plugins.');
    }
  }

  return {
    manifest: {
      id,
      name: readRequiredString(value, 'name'),
      version: readRequiredString(value, 'version'),
      pluginApiVersion,
      description: readRequiredString(value, 'description'),
      surface,
      author: typeof value.author === 'string' && value.author.trim().length > 0 ? value.author.trim() : undefined,
      hostPatterns,
      defaultLaunchUrl,
      permissions,
      entry: readEntry(value),
      runtime,
      marketplace: readMarketplace(value),
    },
    warnings,
  };
}

export function manifestToPackageJson(manifest: SitePluginManifest): unknown {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    plugin_api_version: manifest.pluginApiVersion,
    description: manifest.description,
    ...(manifest.surface && manifest.surface !== 'site' ? { surface: manifest.surface } : {}),
    ...(manifest.author ? { author: manifest.author } : {}),
    host_patterns: manifest.hostPatterns,
    ...(manifest.defaultLaunchUrl ? { default_launch_url: manifest.defaultLaunchUrl } : {}),
    permissions: manifest.permissions,
    entry: manifest.entry,
    ...(manifest.runtime ? { runtime: manifest.runtime } : {}),
    ...(manifest.marketplace ? { marketplace: manifest.marketplace } : {}),
  };
}
