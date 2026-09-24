import test from 'node:test';
import assert from 'node:assert/strict';
import { fitHeightmap, readPngHeader, validateHeightmap, validateTerrainPreview } from './heightmap.js';

test('reads 16-bit grayscale metadata from the PNG header', () => {
  const bytes = new Uint8Array(29);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  bytes.set([0, 0, 16, 0, 0, 0, 16, 0, 16, 0], 16);
  assert.deepEqual(readPngHeader(bytes), { width: 4096, height: 4096, bitDepth: 16, colorType: 0 });
});

test('accepts the official editor heightmap dimensions and PNG format', () => {
  assert.equal(validateHeightmap({ name: 'RiverDelta.png', width: 4096, height: 4096, bitDepth: 16, colorType: 0 }), null);
});

test('rejects preview screenshots and unsupported raster formats', () => {
  assert.match(validateHeightmap({ name: 'preview.png', width: 1920, height: 1080 }), /4096/);
  assert.match(validateHeightmap({ name: 'terrain.tif', width: 4096, height: 4096 }), /PNG/);
  assert.match(validateHeightmap({ name: 'screenshot.png', width: 4096, height: 4096, bitDepth: 8, colorType: 2 }), /16 位灰度/);
});

test('accepts a player heightmap for preview without claiming it is a native CS2 export', () => {
  const sample = { name: 'purerefu_v2_high-res-heightmap.png', width: 2944, height: 1664, bitDepth: 16, colorType: 0 };
  assert.equal(validateTerrainPreview(sample), null);
  assert.match(validateHeightmap(sample), /4096/);
  assert.match(validateTerrainPreview({ ...sample, bitDepth: 8 }), /16 位灰度/);
});

test('fits a rectangular map into the available viewport without distortion', () => {
  assert.deepEqual(fitHeightmap(2944, 1664, 1100, 700), { x: 0, y: 39, width: 1100, height: 622 });
  assert.deepEqual(fitHeightmap(4096, 4096, 1100, 700), { x: 200, y: 0, width: 700, height: 700 });
});
