export class MissingDataError extends Error {}

const DATA_ROOT = "data/";
const cache = new Map<string, Promise<Uint8Array>>();

async function fetchFile(name: string): Promise<Uint8Array> {
  const url = DATA_ROOT + name.toLowerCase();
  const response = await fetch(url);
  const contentType = response.headers.get("content-type") ?? "";
  const isHtmlFallback = contentType.includes("text/html");

  if (!response.ok || isHtmlFallback) {
    throw new MissingDataError(`Missing game file: ${name}`);
  }

  const buffer = await response.arrayBuffer();

  return new Uint8Array(buffer);
}

export function loadFile(name: string): Promise<Uint8Array> {
  const key = name.toLowerCase();
  const cached = cache.get(key);

  if (cached) {
    return cached;
  }

  const pending = fetchFile(key);

  cache.set(key, pending);

  return pending;
}

export async function hasExtractedData(): Promise<boolean> {
  const response = await fetch(`${DATA_ROOT}manifest.json`);
  const contentType = response.headers.get("content-type") ?? "";

  return response.ok && contentType.includes("json");
}

async function readManifest(): Promise<Set<string>> {
  const bytes = await loadFile("manifest.json");
  const text = new TextDecoder().decode(bytes);
  const manifest = JSON.parse(text) as { files: string[] };

  return new Set(manifest.files);
}

export async function hasFile(name: string): Promise<boolean> {
  const files = await readManifest();

  return files.has(name.toLowerCase());
}
