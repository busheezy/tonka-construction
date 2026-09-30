import { closeSync, openSync, readSync } from "node:fs";

const SECTOR_SIZE = 2048;
const PRIMARY_VOLUME_SECTOR = 16;
const ROOT_RECORD_OFFSET = 156;
const DIRECTORY_FLAG = 2;

export interface IsoEntry {
  path: string;
  offset: number;
  size: number;
}

interface DirectoryRecord {
  name: string;
  sector: number;
  size: number;
  isDirectory: boolean;
}

function readBytes(fd: number, position: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);

  readSync(fd, buffer, 0, length, position);

  return buffer;
}

function parseRecord(data: Buffer, offset: number): DirectoryRecord {
  const sector = data.readUInt32LE(offset + 2);
  const size = data.readUInt32LE(offset + 10);
  const flags = data[offset + 25];
  const nameLength = data[offset + 32];
  const rawName = data.toString("latin1", offset + 33, offset + 33 + nameLength);
  const name = rawName.split(";")[0];
  const isDirectory = (flags & DIRECTORY_FLAG) !== 0;

  return { name, sector, size, isDirectory };
}

function isSelfOrParent(data: Buffer, offset: number): boolean {
  const nameLength = data[offset + 32];
  const firstByte = data[offset + 33];

  return nameLength === 1 && firstByte <= 1;
}

function readDirectory(fd: number, directory: DirectoryRecord): DirectoryRecord[] {
  const data = readBytes(fd, directory.sector * SECTOR_SIZE, directory.size);
  const records: DirectoryRecord[] = [];
  let offset = 0;

  while (offset < data.length) {
    const length = data[offset];

    if (length === 0) {
      const nextSector = Math.floor(offset / SECTOR_SIZE) + 1;

      offset = nextSector * SECTOR_SIZE;
      continue;
    }

    if (!isSelfOrParent(data, offset)) {
      const record = parseRecord(data, offset);

      records.push(record);
    }

    offset += length;
  }

  return records;
}

function collectEntries(
  fd: number,
  directory: DirectoryRecord,
  prefix: string,
  out: IsoEntry[],
): void {
  const records = readDirectory(fd, directory);

  for (const record of records) {
    const path = prefix + record.name;

    if (record.isDirectory) {
      collectEntries(fd, record, `${path}/`, out);
      continue;
    }

    const offset = record.sector * SECTOR_SIZE;

    out.push({ path, offset, size: record.size });
  }
}

export function isIsoImage(path: string): boolean {
  const fd = openSync(path, "r");
  const signature = readBytes(fd, PRIMARY_VOLUME_SECTOR * SECTOR_SIZE + 1, 5);

  closeSync(fd);

  return signature.toString("latin1") === "CD001";
}

export function listIso(path: string): IsoEntry[] {
  const fd = openSync(path, "r");
  const volume = readBytes(fd, PRIMARY_VOLUME_SECTOR * SECTOR_SIZE, SECTOR_SIZE);
  const root = parseRecord(volume, ROOT_RECORD_OFFSET);
  const entries: IsoEntry[] = [];

  collectEntries(fd, root, "", entries);
  closeSync(fd);

  return entries;
}

export function readIsoEntry(path: string, entry: IsoEntry): Buffer {
  const fd = openSync(path, "r");
  const data = readBytes(fd, entry.offset, entry.size);

  closeSync(fd);

  return data;
}
