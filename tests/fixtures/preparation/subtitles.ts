import { deflateRawSync } from "node:zlib";

export const episodeOne = `1
00:00:01,000 --> 00:00:03,000
パンダが竹を食べている。

2
00:00:04,000 --> 00:00:06,000
毎日カフェへ行く。
`;

export const episodeTwo = `1
00:00:02.000 --> 00:00:04.000 align:start
白熊は料理を作っている。

2
00:00:05,000 --> 00:00:07,000
パンダもカフェへ行く。
`;

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

const u16 = (value: number): Uint8Array =>
  Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);

const u32 = (value: number): Uint8Array =>
  Uint8Array.of(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );

const join = (parts: readonly Uint8Array[]): Uint8Array => {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

export const buildZip = (
  entries: readonly Readonly<{
    name: string;
    text: string;
    method?: 0 | 8;
    flags?: number;
    localFlags?: number;
    corruptCrc?: boolean;
    dataDescriptor?: boolean;
  }>[],
): Uint8Array => {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const raw = new TextEncoder().encode(entry.text);
    const method = entry.method ?? 8;
    const flags = (entry.flags ?? 0) | 0x0800 | (entry.dataDescriptor ? 0x0008 : 0);
    const localFlags = (entry.localFlags ?? flags) | 0x0800;
    const compressed = method === 0 ? raw : Uint8Array.from(deflateRawSync(raw));
    const crc = (crc32(raw) + (entry.corruptCrc === true ? 1 : 0)) >>> 0;
    const local = join([
      u32(0x04034b50),
      u16(20),
      u16(localFlags),
      u16(method),
      u16(0),
      u16(0),
      u32(entry.dataDescriptor ? 0 : crc),
      u32(entry.dataDescriptor ? 0 : compressed.length),
      u32(entry.dataDescriptor ? 0 : raw.length),
      u16(name.length),
      u16(0),
      name,
      compressed,
      ...(entry.dataDescriptor
        ? [u32(0x08074b50), u32(crc), u32(compressed.length), u32(raw.length)]
        : []),
    ]);
    localParts.push(local);
    centralParts.push(
      join([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(flags),
        u16(method),
        u16(0),
        u16(0),
        u32(crc),
        u32(compressed.length),
        u32(raw.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(localOffset),
        name,
      ]),
    );
    localOffset += local.length;
  }
  const central = join(centralParts);
  return join([
    ...localParts,
    central,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.length),
    u32(localOffset),
    u16(0),
  ]);
};
