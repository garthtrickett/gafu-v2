import { inflateRawSync } from "node:zlib";
import { err, ok, type Result } from "../result.ts";
import type {
  ImportEntryRejection,
  ImportEntryReport,
  ImportFile,
  SubtitleImportPolicy,
} from "./import-contracts.ts";

type ArchiveEntry = Readonly<{
  displayName: string;
  bytes: Uint8Array | null;
  rejection: ImportEntryReport | null;
}>;

const signature = (view: DataView, offset: number): number =>
  view.getUint32(offset, true);

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let current = value;
  for (let bit = 0; bit < 8; bit += 1) {
    current = (current & 1) === 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
  }
  return current >>> 0;
});

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crcTable[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const safeName = (bytes: Uint8Array, utf8: boolean): string | null => {
  try {
    if (!utf8 && bytes.some((byte) => byte > 0x7f)) return null;
    const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (
      name === "" ||
      name.includes("\0") ||
      name.startsWith("/") ||
      name.startsWith("\\") ||
      /^[A-Za-z]:/u.test(name) ||
      name.split(/[\\/]/u).includes("..")
    ) {
      return null;
    }
    return name.replace(/\\/gu, "/");
  } catch {
    return null;
  }
};

const rejection = (
  displayName: string,
  reason: ImportEntryRejection,
  detail: string,
): ArchiveEntry => ({
  displayName,
  bytes: null,
  rejection: { outcome: "rejected", displayName, reason, detail },
});

const locateEocd = (view: DataView): number => {
  const lower = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= lower; offset -= 1) {
    if (signature(view, offset) === 0x06054b50) return offset;
  }
  return -1;
};

export const inspectZip = (
  archive: ImportFile,
  policy: SubtitleImportPolicy,
): Result<
  readonly ArchiveEntry[],
  Readonly<{
    kind: "corruptArchive" | "entryLimitExceeded" | "inflationLimitExceeded";
    detail: string;
  }>
> => {
  const bytes = archive.bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 22) {
    return err({ kind: "corruptArchive", detail: "ZIP end record is missing." });
  }
  const eocd = locateEocd(view);
  if (eocd < 0) {
    return err({ kind: "corruptArchive", detail: "ZIP end record is missing." });
  }
  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const commentLength = view.getUint16(eocd + 20, true);
  if (eocd + 22 + commentLength !== bytes.byteLength) {
    return err({
      kind: "corruptArchive",
      detail: "ZIP end record comment length is inconsistent.",
    });
  }
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    return err({ kind: "corruptArchive", detail: "Multi-disk ZIP is unsupported." });
  }
  if (
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    return err({ kind: "corruptArchive", detail: "ZIP64 is unsupported." });
  }
  if (entryCount > policy.maximumEntries) {
    return err({
      kind: "entryLimitExceeded",
      detail: `Archive exceeds ${policy.maximumEntries} entries.`,
    });
  }
  if (
    centralOffset + centralSize > eocd ||
    centralOffset + centralSize > bytes.byteLength
  ) {
    return err({
      kind: "corruptArchive",
      detail: "Central directory is out of range.",
    });
  }

  const results: ArchiveEntry[] = [];
  let declaredUncompressedTotal = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.byteLength || signature(view, cursor) !== 0x02014b50) {
      return err({
        kind: "corruptArchive",
        detail: "Central directory entry is malformed.",
      });
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const expectedCrc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    if (uncompressedSize !== 0xffffffff) {
      declaredUncompressedTotal += uncompressedSize;
    }
    if (declaredUncompressedTotal > policy.maximumInflatedBytes) {
      return err({
        kind: "inflationLimitExceeded",
        detail: `Archive declares more than ${policy.maximumInflatedBytes} inflated bytes.`,
      });
    }
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.byteLength) {
      return err({
        kind: "corruptArchive",
        detail: "Central directory name is out of range.",
      });
    }
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = safeName(nameBytes, (flags & 0x0800) !== 0);
    const displayName = name ?? `unsafe-entry-${index + 1}`;
    cursor = end;
    if (name === null) {
      results.push(
        rejection(
          displayName,
          "unsafeName",
          "Archive entry name is unsafe or unsupported.",
        ),
      );
      continue;
    }
    if (name.endsWith("/")) {
      results.push(
        rejection(name, "directory", "Directory entries are not subtitle files."),
      );
      continue;
    }
    const extension = name.toLocaleLowerCase();
    if (extension.endsWith(".zip")) {
      results.push(
        rejection(name, "nestedArchive", "Nested archives are unsupported."),
      );
      continue;
    }
    if (!extension.endsWith(".srt")) {
      results.push(
        rejection(name, "unsupportedExtension", "Only .srt entries are analyzed."),
      );
      continue;
    }
    if ((flags & 1) !== 0) {
      results.push(
        rejection(name, "encrypted", "Encrypted ZIP entries are unsupported."),
      );
      continue;
    }
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      results.push(rejection(name, "zip64", "ZIP64 entries are unsupported."));
      continue;
    }
    if (method !== 0 && method !== 8) {
      results.push(
        rejection(
          name,
          "unsupportedCompression",
          `Compression method ${method} is unsupported.`,
        ),
      );
      continue;
    }
    if (uncompressedSize > policy.maximumSrtBytes) {
      results.push(
        rejection(
          name,
          "fileTooLarge",
          `Entry exceeds ${policy.maximumSrtBytes} bytes.`,
        ),
      );
      continue;
    }
    if (
      (compressedSize === 0 && uncompressedSize > 0) ||
      (compressedSize > 0 &&
        uncompressedSize / compressedSize > policy.maximumCompressionRatio)
    ) {
      results.push(
        rejection(
          name,
          "compressionRatioExceeded",
          `Entry exceeds ${policy.maximumCompressionRatio}:1.`,
        ),
      );
      continue;
    }
    if (
      localOffset + 30 > bytes.byteLength ||
      signature(view, localOffset) !== 0x04034b50
    ) {
      results.push(
        rejection(name, "corruptArchiveEntry", "Local ZIP header is missing."),
      );
      continue;
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localFlags = view.getUint16(localOffset + 6, true);
    const localMethod = view.getUint16(localOffset + 8, true);
    const localNameStart = localOffset + 30;
    const localNameEnd = localNameStart + localNameLength;
    if (localNameEnd > bytes.byteLength) {
      results.push(
        rejection(name, "corruptArchiveEntry", "Local ZIP name is out of range."),
      );
      continue;
    }
    const localName = bytes.subarray(localNameStart, localNameEnd);
    if (
      localFlags !== flags ||
      localMethod !== method ||
      localName.length !== nameBytes.length ||
      localName.some((byte, offset) => byte !== nameBytes[offset])
    ) {
      results.push(
        rejection(
          name,
          "corruptArchiveEntry",
          "Local and central ZIP headers disagree.",
        ),
      );
      continue;
    }
    if ((flags & 0x0008) === 0) {
      const localCrc = view.getUint32(localOffset + 14, true);
      const localCompressedSize = view.getUint32(localOffset + 18, true);
      const localUncompressedSize = view.getUint32(localOffset + 22, true);
      if (
        localCrc !== expectedCrc ||
        localCompressedSize !== compressedSize ||
        localUncompressedSize !== uncompressedSize
      ) {
        results.push(
          rejection(
            name,
            "corruptArchiveEntry",
            "Local and central ZIP sizes or CRC disagree.",
          ),
        );
        continue;
      }
    }
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > bytes.byteLength) {
      results.push(
        rejection(name, "corruptArchiveEntry", "Compressed entry is out of range."),
      );
      continue;
    }
    let inflated: Uint8Array;
    try {
      const payload = bytes.subarray(dataOffset, dataOffset + compressedSize);
      inflated =
        method === 0
          ? Uint8Array.from(payload)
          : Uint8Array.from(
              inflateRawSync(payload, { maxOutputLength: policy.maximumSrtBytes + 1 }),
            );
    } catch {
      results.push(
        rejection(name, "corruptArchiveEntry", "Entry could not be inflated."),
      );
      continue;
    }
    if (inflated.byteLength !== uncompressedSize || crc32(inflated) !== expectedCrc) {
      results.push(
        rejection(
          name,
          "corruptArchiveEntry",
          "Entry size or CRC does not match the archive.",
        ),
      );
      continue;
    }
    results.push({ displayName: name, bytes: inflated, rejection: null });
  }
  if (cursor !== centralOffset + centralSize) {
    return err({
      kind: "corruptArchive",
      detail: "Central directory size is inconsistent.",
    });
  }
  return ok(results);
};
