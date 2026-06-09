import {
  validateSitePluginManifest,
  type SitePluginManifest,
} from './pluginManifest';
import { createZip, sha256Hex, toArrayBuffer } from './zip';

export interface PluginDirectoryFile {
  path: string;
  file: File;
  size: number;
}

export interface LoadedPluginDirectory {
  rootName: string;
  files: PluginDirectoryFile[];
  manifest: SitePluginManifest;
  manifestSource: string;
  rendererSource: string;
  warnings: string[];
}

export interface PackagedPluginDirectory {
  fileName: string;
  archive: Uint8Array;
  blob: Blob;
  sha256: string;
}

const EXCLUDED_PATH_PARTS = new Set(['.git', 'node_modules']);

function normalizePath(rawPath: string): string {
  return rawPath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .join('/');
}

function shouldIgnorePath(path: string): boolean {
  if (!path || path.endsWith('/')) {
    return true;
  }
  const fileName = path.split('/').pop() ?? '';
  if (fileName === '.DS_Store' || fileName.endsWith('.wpp')) {
    return true;
  }
  return path.split('/').some((part) => EXCLUDED_PATH_PARTS.has(part));
}

function getBrowserRelativePath(file: File): string {
  const webkitPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return normalizePath(webkitPath || file.name);
}

function stripPrefix(path: string, prefix: string): string {
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function normalizePackageRoot(files: PluginDirectoryFile[]): PluginDirectoryFile[] {
  if (files.some((entry) => entry.path === 'manifest.json')) {
    return files;
  }

  const manifestCandidates = files.filter((entry) => entry.path.endsWith('/manifest.json'));
  if (manifestCandidates.length === 1) {
    const prefix = manifestCandidates[0].path.slice(0, -'manifest.json'.length);
    if (files.every((entry) => entry.path.startsWith(prefix))) {
      return files.map((entry) => ({
        ...entry,
        path: stripPrefix(entry.path, prefix),
      }));
    }
  }

  const firstSegments = new Set(files.map((entry) => entry.path.split('/')[0]).filter(Boolean));
  if (firstSegments.size === 1) {
    const [segment] = Array.from(firstSegments);
    const prefix = `${segment}/`;
    const stripped = files.map((entry) => ({
      ...entry,
      path: stripPrefix(entry.path, prefix),
    }));
    if (stripped.some((entry) => entry.path === 'manifest.json')) {
      return stripped;
    }
  }

  return files;
}

function readText(file: File): Promise<string> {
  return file.text();
}

async function readBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export async function readPluginDirectory(fileList: FileList): Promise<LoadedPluginDirectory> {
  const rawFiles = Array.from(fileList).map((file) => ({
    path: getBrowserRelativePath(file),
    file,
    size: file.size,
  }));
  const packageFiles = normalizePackageRoot(rawFiles.filter((entry) => !shouldIgnorePath(entry.path)));
  if (packageFiles.length === 0) {
    throw new Error('The directory is empty or has no packageable files');
  }

  const pathSet = new Set<string>();
  packageFiles.forEach((entry) => {
    if (pathSet.has(entry.path)) {
      throw new Error(`Duplicate file path in directory: ${entry.path}`);
    }
    pathSet.add(entry.path);
  });

  const manifestEntry = packageFiles.find((entry) => entry.path === 'manifest.json');
  if (!manifestEntry) {
    throw new Error('The plugin directory root is missing manifest.json');
  }

  const manifestSource = await readText(manifestEntry.file);
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestSource);
  } catch (error) {
    throw new Error(`manifest.json is not valid JSON: ${error instanceof Error ? error.message : 'parse failed'}`);
  }

  const { manifest, warnings } = validateSitePluginManifest(manifestJson);
  const rendererEntry = packageFiles.find((entry) => entry.path === manifest.entry.renderer);
  if (!rendererEntry) {
    throw new Error(`Missing renderer entry: ${manifest.entry.renderer}`);
  }
  if (!packageFiles.some((entry) => entry.path === manifest.entry.main)) {
    throw new Error(`Missing main entry: ${manifest.entry.main}`);
  }

  const totalSize = packageFiles.reduce((sum, entry) => sum + entry.size, 0);
  const packageWarnings = [...warnings];
  if (totalSize > 10 * 1024 * 1024) {
    packageWarnings.push('The package is larger than 10 MB; check for development cache or unrelated assets.');
  }

  return {
    rootName: getBrowserRelativePath(Array.from(fileList)[0] ?? manifestEntry.file).split('/')[0] || manifest.id,
    files: packageFiles.sort((left, right) => left.path.localeCompare(right.path)),
    manifest,
    manifestSource,
    rendererSource: await readText(rendererEntry.file),
    warnings: packageWarnings,
  };
}

export async function packagePluginDirectory(directory: LoadedPluginDirectory): Promise<PackagedPluginDirectory> {
  const entries = await Promise.all(
    directory.files.map(async (entry) => ({
      path: entry.path,
      data: await readBytes(entry.file),
    })),
  );
  entries.sort((left, right) => left.path.localeCompare(right.path));

  const archive = createZip(entries);
  const sha256 = await sha256Hex(archive);
  const fileName = `${directory.manifest.id}.wpp`;
  return {
    fileName,
    archive,
    blob: new Blob([toArrayBuffer(archive)], { type: 'application/octet-stream' }),
    sha256,
  };
}

export function downloadPackagedPlugin(packageResult: PackagedPluginDirectory): void {
  const url = URL.createObjectURL(packageResult.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = packageResult.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
