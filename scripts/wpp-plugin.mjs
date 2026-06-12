import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_API_VERSION = '1.0.0';
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const SUPPORTED_PERMISSIONS = new Set(['cookies', 'executeScript', 'network', 'openWindow', 'terminal']);
const SUPPORTED_RUNTIME_TYPES = new Set(['builtin-adapter', 'external-module']);
const MAIN_APP_BUILTIN_ADAPTERS = new Set(['x-timeline', 'polymarket-event', 'terminal', 'clock', 'calendar']);
const EXCLUDED_PATH_PARTS = new Set(['.git', 'node_modules']);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(scriptDir, '..');

let crcTable = null;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequiredString(record, key) {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`manifest.json is missing ${key}`);
  }
  return value.trim();
}

function readRequiredStringFromKeys(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  throw new Error(`manifest.json is missing ${keys[0]}`);
}

function readStringArray(record, key, options = {}) {
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

function readStringArrayFromKeys(record, keys, options = {}) {
  for (const key of keys) {
    if (Array.isArray(record[key]) && (options.allowEmpty || record[key].length > 0)) {
      return readStringArray(record, key, options);
    }
  }
  throw new Error(`manifest.json is missing ${keys[0]}`);
}

function readSurface(record) {
  if (typeof record.surface === 'undefined') {
    return undefined;
  }
  if (record.surface !== 'site' && record.surface !== 'utility') {
    throw new Error('manifest.json surface must be "site" or "utility"');
  }
  return record.surface;
}

function readDefaultLaunchUrl(record, surface) {
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

function normalizePackageRelativePath(value, key) {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/');
  if (!normalized || parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw new Error(`manifest.json ${key} must be a valid relative path`);
  }
  return parts.join('/');
}

function readEntry(record) {
  const value = record.entry;
  if (!isRecord(value)) {
    throw new Error('manifest.json is missing entry');
  }
  return {
    renderer: normalizePackageRelativePath(readRequiredString(value, 'renderer'), 'entry.renderer'),
    main: normalizePackageRelativePath(readRequiredString(value, 'main'), 'entry.main'),
  };
}

function readRuntime(record) {
  const value = record.runtime;
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error('manifest.json runtime must be an object');
  }

  const type = readRequiredString(value, 'type');
  if (!SUPPORTED_RUNTIME_TYPES.has(type)) {
    throw new Error(`Unsupported runtime.type: ${type}`);
  }

  const adapter = typeof value.adapter === 'string' ? value.adapter.trim() : undefined;
  if (type === 'builtin-adapter' && !adapter) {
    throw new Error('builtin-adapter plugins must declare runtime.adapter');
  }

  return {
    type,
    ...(adapter ? { adapter } : {}),
  };
}

function readMarketplace(record) {
  const value = record.marketplace;
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error('manifest.json marketplace must be an object');
  }

  const tags = Array.isArray(value.tags)
    ? value.tags.filter((item) => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : undefined;
  const highlights = Array.isArray(value.highlights)
    ? value.highlights
        .filter((item) => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    : undefined;

  return {
    ...(tags ? { tags } : {}),
    ...(highlights ? { highlights } : {}),
  };
}

function validateManifest(value) {
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
    if (!SUPPORTED_PERMISSIONS.has(permission)) {
      throw new Error(`Unsupported plugin permission: ${permission}`);
    }
    return permission;
  });

  const runtime = readRuntime(value);
  const surface = readSurface(value) ?? 'site';
  const hostPatterns = readStringArrayFromKeys(value, ['hostPatterns', 'host_patterns'], {
    allowEmpty: surface === 'utility',
  });
  const defaultLaunchUrl = readDefaultLaunchUrl(value, surface);
  const warnings = [];
  if (!runtime) {
    warnings.push('manifest.runtime is missing; Dev Studio previews it as external-module.');
  }
  if (runtime?.type === 'builtin-adapter') {
    if (runtime.adapter !== id) {
      warnings.push('builtin-adapter runtime.adapter should match manifest.id.');
    }
    if (!MAIN_APP_BUILTIN_ADAPTERS.has(runtime.adapter ?? '')) {
      warnings.push('The main app only ships controlled built-in adapters; use external-module for third-party plugins.');
    }
  }
  if (runtime?.type === 'external-module') {
    warnings.push('external-module runs in the WebPanel sandbox runtime; do not use main require() or direct Electron APIs.');
  }

  return {
    manifest: {
      id,
      name: readRequiredString(value, 'name'),
      version: readRequiredString(value, 'version'),
      pluginApiVersion,
      description: readRequiredString(value, 'description'),
      ...(surface !== 'site' ? { surface } : {}),
      ...(typeof value.author === 'string' && value.author.trim().length > 0 ? { author: value.author.trim() } : {}),
      hostPatterns,
      ...(defaultLaunchUrl ? { defaultLaunchUrl } : {}),
      permissions,
      entry: readEntry(value),
      ...(runtime ? { runtime } : {}),
      ...(value.marketplace ? { marketplace: readMarketplace(value) } : {}),
    },
    warnings,
  };
}

function normalizePackagePath(rawPath) {
  return rawPath.replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter(Boolean).join('/');
}

function shouldIgnorePackagePath(packagePath) {
  if (!packagePath || packagePath.endsWith('/')) {
    return true;
  }
  const fileName = packagePath.split('/').pop() ?? '';
  if (fileName === '.DS_Store' || fileName.endsWith('.wpp')) {
    return true;
  }
  return packagePath.split('/').some((part) => EXCLUDED_PATH_PARTS.has(part));
}

async function collectPackageFiles(rootDir, currentDir = rootDir) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = normalizePackagePath(path.relative(rootDir, absolutePath));
    if (shouldIgnorePackagePath(relativePath)) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await collectPackageFiles(rootDir, absolutePath)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const fileStats = await stat(absolutePath);
    files.push({
      path: relativePath,
      absolutePath,
      size: fileStats.size,
    });
  }

  return files;
}

async function validatePluginDirectory(pluginDir) {
  const rootDir = path.resolve(pluginDir);
  const rootStats = await stat(rootDir).catch(() => null);
  if (!rootStats?.isDirectory()) {
    throw new Error(`Plugin directory does not exist: ${rootDir}`);
  }

  const files = (await collectPackageFiles(rootDir)).sort((left, right) => left.path.localeCompare(right.path));
  if (files.length === 0) {
    throw new Error('The plugin directory is empty or has no packageable files');
  }

  const pathSet = new Set();
  for (const file of files) {
    if (pathSet.has(file.path)) {
      throw new Error(`Duplicate file path in directory: ${file.path}`);
    }
    pathSet.add(file.path);
  }

  const manifestFile = files.find((file) => file.path === 'manifest.json');
  if (!manifestFile) {
    throw new Error('The plugin directory root is missing manifest.json');
  }

  let manifestJson;
  try {
    manifestJson = JSON.parse(await readFile(manifestFile.absolutePath, 'utf8'));
  } catch (error) {
    throw new Error(`manifest.json is not valid JSON: ${error instanceof Error ? error.message : 'parse failed'}`);
  }

  const { manifest, warnings } = validateManifest(manifestJson);
  if (!pathSet.has(manifest.entry.renderer)) {
    throw new Error(`Missing renderer entry: ${manifest.entry.renderer}`);
  }
  if (!pathSet.has(manifest.entry.main)) {
    throw new Error(`Missing main entry: ${manifest.entry.main}`);
  }

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const packageWarnings = [...warnings];
  if (totalSize > 10 * 1024 * 1024) {
    packageWarnings.push('The package is larger than 10 MB; check for development cache or unrelated assets.');
  }

  return {
    rootDir,
    files,
    manifest,
    warnings: packageWarnings,
    totalSize,
  };
}

function formatBytes(value) {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function getCrcTable() {
  if (crcTable) {
    return crcTable;
  }
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

function crc32(data) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    dosTime:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      Math.floor(date.getUTCSeconds() / 2),
    dosDate:
      ((year - 1980) << 9) |
      ((date.getUTCMonth() + 1) << 5) |
      date.getUTCDate(),
  };
}

function writeUInt16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function writeUInt32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function assertZip32Size(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} exceeds ZIP32 limits`);
  }
}

function createZip(entries) {
  if (entries.length > 0xffff) {
    throw new Error('File count exceeds ZIP32 limits');
  }

  const localParts = [];
  const centralParts = [];
  const { dosDate, dosTime } = dosDateTime();
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const checksum = crc32(entry.data);
    assertZip32Size(entry.data.length, `${entry.path} file size`);
    assertZip32Size(offset, `${entry.path} file offset`);

    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(0x0800),
      writeUInt16(0),
      writeUInt16(dosTime),
      writeUInt16(dosDate),
      writeUInt32(checksum),
      writeUInt32(entry.data.length),
      writeUInt32(entry.data.length),
      writeUInt16(name.length),
      writeUInt16(0),
      name,
    ]);
    localParts.push(localHeader, entry.data);

    const centralHeader = Buffer.concat([
      writeUInt32(0x02014b50),
      writeUInt16(20),
      writeUInt16(20),
      writeUInt16(0x0800),
      writeUInt16(0),
      writeUInt16(dosTime),
      writeUInt16(dosDate),
      writeUInt32(checksum),
      writeUInt32(entry.data.length),
      writeUInt32(entry.data.length),
      writeUInt16(name.length),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(0),
      writeUInt32(offset),
      name,
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + entry.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  assertZip32Size(centralDirectory.length, 'central directory size');
  assertZip32Size(offset, 'central directory offset');

  const end = Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(entries.length),
    writeUInt16(entries.length),
    writeUInt32(centralDirectory.length),
    writeUInt32(offset),
    writeUInt16(0),
  ]);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function printValidationResult(result) {
  console.log(`Validated ${result.manifest.id} (${result.manifest.runtime?.type ?? 'external-module'})`);
  console.log(`Files: ${result.files.length}`);
  console.log(`Size: ${formatBytes(result.totalSize)}`);
  if (result.warnings.length > 0) {
    console.log('Warnings:');
    result.warnings.forEach((warning) => console.log(`- ${warning}`));
  }
}

function parseOutDir(args) {
  const outIndex = args.findIndex((arg) => arg === '--out' || arg === '-o');
  if (outIndex === -1) {
    return {
      outDir: path.join(studioRoot, 'dist-plugins'),
      remaining: args,
    };
  }
  const outDir = args[outIndex + 1];
  if (!outDir) {
    throw new Error('--out requires a directory path');
  }
  return {
    outDir: path.resolve(outDir),
    remaining: [...args.slice(0, outIndex), ...args.slice(outIndex + 2)],
  };
}

function stripArgumentSeparator(args) {
  return args[0] === '--' ? args.slice(1) : args;
}

async function runValidate(args) {
  const [pluginDir] = stripArgumentSeparator(args);
  if (!pluginDir) {
    throw new Error('Usage: node scripts/wpp-plugin.mjs validate <plugin-directory>');
  }
  const result = await validatePluginDirectory(pluginDir);
  printValidationResult(result);
}

async function runPack(args) {
  const { outDir, remaining } = parseOutDir(stripArgumentSeparator(args));
  const [pluginDir] = remaining;
  if (!pluginDir) {
    throw new Error('Usage: node scripts/wpp-plugin.mjs pack <plugin-directory> [--out <output-directory>]');
  }

  const result = await validatePluginDirectory(pluginDir);
  const zipEntries = await Promise.all(
    result.files.map(async (file) => ({
      path: file.path,
      data: await readFile(file.absolutePath),
    })),
  );
  const archive = createZip(zipEntries);
  const sha256 = createHash('sha256').update(archive).digest('hex');
  const fileName = `${result.manifest.id}.wpp`;
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, fileName);
  await writeFile(outPath, archive);

  printValidationResult(result);
  console.log(`Package: ${outPath}`);
  console.log(`SHA-256: ${sha256}`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'validate') {
    await runValidate(args);
    return;
  }
  if (command === 'pack') {
    await runPack(args);
    return;
  }
  throw new Error('Usage: node scripts/wpp-plugin.mjs <validate|pack> <plugin-directory>');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
