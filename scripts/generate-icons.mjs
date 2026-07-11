import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const sizes = [16, 32, 48, 96, 128];
const outputDirectory = fileURLToPath(
  new URL('../public/icon/', import.meta.url),
);

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function containsRoundedSquare(x, y, size) {
  const radius = size * 0.1875;
  const nearestX = Math.max(radius, Math.min(size - radius, x));
  const nearestY = Math.max(radius, Math.min(size - radius, y));
  return (x - nearestX) ** 2 + (y - nearestY) ** 2 <= radius ** 2;
}

function pixelAt(x, y, size) {
  if (!containsRoundedSquare(x, y, size)) return [0, 0, 0, 0];

  const unitX = (x * 128) / size;
  const unitY = (y * 128) / size;
  const inLetter =
    (unitX >= 31 && unitX < 49 && unitY >= 29 && unitY < 99) ||
    (unitX >= 31 && unitX < 97 && unitY >= 81 && unitY < 99);
  const inNotch =
    unitX >= 78 &&
    unitX <= 97 &&
    unitY >= 99 &&
    unitY <= 116 &&
    unitX - 78 >= (unitY - 99) * (19 / 17);

  if (inLetter) return [255, 255, 255, 255];
  if (inNotch) return [23, 32, 42, 255];
  return [229, 72, 63, 255];
}

function createPng(size) {
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = [0];
    for (let x = 0; x < size; x += 1) row.push(...pixelAt(x, y, size));
    rows.push(Buffer.from(row));
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of sizes) {
  writeFileSync(`${outputDirectory}${size}.png`, createPng(size));
}
