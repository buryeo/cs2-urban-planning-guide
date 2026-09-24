import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTerrainDistricts, terrainDistrictAt } from './terrain-districts.js';

const grid = (width, height, blocked = () => false, elevation = () => 0) => ({
  width, height,
  land: Uint8Array.from({ length: width * height }, (_, index) => blocked(index % width, Math.floor(index / width)) ? 0 : 1),
  elevation: Float32Array.from({ length: width * height }, (_, index) => elevation(index % width, Math.floor(index / width))),
});
const node = (id, x, y, radius = 8) => ({ id, x, y, radius });

test('a water channel leaves two separately seeded shores disconnected', () => {
  const terrain = grid(13, 7, (x) => x === 6);
  const result = makeTerrainDistricts(terrain, [node('west', 2, 3), node('east', 10, 3)], { originX: 0, mapSize: 13, metersPerCell: 1 });
  assert.equal(terrainDistrictAt(result, 2, 3), 'west');
  assert.equal(terrainDistrictAt(result, 10, 3), 'east');
  assert.equal(terrainDistrictAt(result, 6, 3), null);
  assert.ok([...Array(7)].every((_, y) => terrainDistrictAt(result, 6, y) === null));
});

test('a steep ridge remains unplanned instead of joining neighboring districts', () => {
  const terrain = grid(13, 7, () => false, (x) => x === 6 ? 100 : 0);
  const result = makeTerrainDistricts(terrain, [node('west', 2, 3), node('east', 10, 3)], { originX: 0, mapSize: 13, metersPerCell: 1, maxGrade: .18 });
  assert.equal(terrainDistrictAt(result, 2, 3), 'west');
  assert.equal(terrainDistrictAt(result, 10, 3), 'east');
  assert.equal(terrainDistrictAt(result, 6, 3), null);
  assert.equal(terrainDistrictAt(result, 5, 3), null);
});

test('land beyond a node influence stays outside every district', () => {
  const terrain = grid(21, 5);
  const result = makeTerrainDistricts(terrain, [node('center', 2, 2, 2)], { originX: 0, mapSize: 21, metersPerCell: 1 });
  assert.equal(terrainDistrictAt(result, 2, 2), 'center');
  assert.equal(terrainDistrictAt(result, 20, 2), null);
});

test('flat nearby centers still divide accessible land', () => {
  const terrain = grid(13, 5);
  const result = makeTerrainDistricts(terrain, [node('a', 2, 2), node('b', 10, 2)], { originX: 0, mapSize: 13, metersPerCell: 1 });
  assert.equal(terrainDistrictAt(result, 4, 2), 'a');
  assert.equal(terrainDistrictAt(result, 8, 2), 'b');
});

test('wide and tall node shapes guide district reach on flat land', () => {
  const terrain = grid(41, 41);
  const options = { originX: 0, mapSize: 41, metersPerCell: 1 };
  const wide = makeTerrainDistricts(terrain, [{ ...node('wide', 20, 20, 6), shape: 'wide' }], options);
  const tall = makeTerrainDistricts(terrain, [{ ...node('tall', 20, 20, 6), shape: 'tall' }], options);
  assert.equal(terrainDistrictAt(wide, 34, 20), 'wide');
  assert.equal(terrainDistrictAt(wide, 20, 34), null);
  assert.equal(terrainDistrictAt(tall, 34, 20), null);
  assert.equal(terrainDistrictAt(tall, 20, 34), 'tall');
});

test('rotating an oval turns its terrain district along the chosen angle', () => {
  const terrain = grid(41, 41);
  const options = { originX: 0, mapSize: 41, metersPerCell: 1 };
  const diagonal = makeTerrainDistricts(terrain, [{ ...node('oval', 20, 20, 6), shape: 'wide', angle: 45 }], options);
  assert.equal(terrainDistrictAt(diagonal, 30, 30), 'oval');
  assert.equal(terrainDistrictAt(diagonal, 30, 10), null);
});
