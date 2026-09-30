import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { isIsoImage, listIso, readIsoEntry } from "./iso9660.ts";

const OUTPUT_DIR = resolve(import.meta.dirname, "..", "public", "data");
const KNOWN_EXE_SHA256 = "33a9dbae041bc6d8dc9eb6e8575c004b12547729e6a7d8cd20fe6d7c13e55452";
const WANTED_EXTENSIONS = new Set(["dat", "wav", "bin", "pos", "pcx", "mve", "exe"]);
const REQUIRED_FILES = ["tonka.exe", "module01.dat", "module10.dat", "snds/btnclik1.wav"];

interface SourceFile {
  name: string;
  read: () => Buffer;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");

  return name.slice(dot + 1);
}

function toDataName(path: string): string | undefined {
  const normalized = path.toLowerCase().split(sep).join("/");
  const marker = normalized.lastIndexOf("data/");

  if (marker === -1) {
    return undefined;
  }

  const name = normalized.slice(marker + "data/".length);
  const extension = extensionOf(name);

  if (!WANTED_EXTENSIONS.has(extension)) {
    return undefined;
  }

  if (extension === "exe" && name !== "tonka.exe") {
    return undefined;
  }

  return name;
}

function isoSources(isoPath: string): SourceFile[] {
  const entries = listIso(isoPath);
  const sources: SourceFile[] = [];

  for (const entry of entries) {
    const name = toDataName(entry.path);

    if (!name) {
      continue;
    }

    sources.push({ name, read: () => readIsoEntry(isoPath, entry) });
  }

  return sources;
}

function walkDirectory(root: string): string[] {
  const entries = readdirSync(root, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());

  return files.map((entry) => join(entry.parentPath, entry.name));
}

function directorySources(root: string): SourceFile[] {
  const files = walkDirectory(root);
  const sources: SourceFile[] = [];
  const hasDataFolder = files.some((file) =>
    relative(root, file).toLowerCase().startsWith(`data${sep}`),
  );

  for (const file of files) {
    const relativePath = relative(root, file);
    const pathWithData = hasDataFolder ? relativePath : join("data", relativePath);
    const name = toDataName(pathWithData);

    if (!name) {
      continue;
    }

    sources.push({ name, read: () => readFileSync(file) });
  }

  return sources;
}

function findSources(inputPath: string): SourceFile[] {
  const stats = statSync(inputPath);

  if (stats.isDirectory()) {
    return directorySources(inputPath);
  }

  if (!isIsoImage(inputPath)) {
    throw new Error(`${inputPath} is not an ISO 9660 disc image or a folder.`);
  }

  return isoSources(inputPath);
}

function checkRequiredFiles(sources: SourceFile[]): void {
  const names = new Set(sources.map((source) => source.name));
  const missing = REQUIRED_FILES.filter((name) => !names.has(name));

  if (missing.length > 0) {
    throw new Error(
      `Game files not found: ${missing.join(", ")}. Point this at the CD image or its DATA folder.`,
    );
  }
}

function sha256(data: Buffer): string {
  const hash = createHash("sha256");

  hash.update(data);

  return hash.digest("hex");
}

function writeSource(source: SourceFile): number {
  const data = source.read();
  const target = join(OUTPUT_DIR, source.name);
  const targetDir = target.slice(0, target.lastIndexOf(sep));

  mkdirSync(targetDir, { recursive: true });
  writeFileSync(target, data);

  if (source.name === "tonka.exe") {
    const digest = sha256(data);

    if (digest !== KNOWN_EXE_SHA256) {
      console.warn(
        `Warning: tonka.exe does not match the known version (${digest}). The game may not work.`,
      );
    }
  }

  return data.length;
}

function main(): void {
  const inputArgument = process.argv[2];

  if (!inputArgument) {
    console.error("Usage: pnpm extract <path to the CD image (.iso) or the game's folder>");
    process.exit(1);
  }

  const inputPath = resolve(inputArgument);

  if (!existsSync(inputPath)) {
    console.error(`Not found: ${inputPath}`);
    process.exit(1);
  }

  const sources = findSources(inputPath);

  checkRequiredFiles(sources);
  rmSync(OUTPUT_DIR, { recursive: true, force: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const files = sources.map((source) => source.name).sort();
  const sizes = sources.map(writeSource);
  const totalBytes = sizes.reduce((sum, size) => sum + size, 0);
  const manifest = { files };
  const manifestPath = join(OUTPUT_DIR, "manifest.json");
  const megabytes = (totalBytes / 1024 / 1024).toFixed(1);

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(
    `Extracted ${files.length} files (${megabytes} MB) to ${relative(process.cwd(), OUTPUT_DIR)}`,
  );
}

main();
