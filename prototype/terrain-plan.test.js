import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDefaultNodes } from './planner.js';
import { imagePoint, isWaterColor, nearestLandPoint, placeTerrainNodes, terrainConnections } from './terrain-plan.js';

test('terrain coordinates keep the complete square source inside the planning canvas', () => {
  assert.deepEqual(imagePoint(0, 0), { x: 200, y: 0 });
  assert.deepEqual(imagePoint(1, 1), { x: 900, y: 700 });
});

test('sea blue is water and pale green land is land', () => {
  assert.equal(isWaterColor(151, 194, 221), true);
  assert.equal(isWaterColor(218, 230, 208), false);
});

test('node placement moves a water anchor to nearby land', () => {
  const land = (x, y) => x >= 550;
  const point = nearestLandPoint({ x: 525, y: 340 }, land, { left: 200, right: 900, top: 0, bottom: 700 });
  assert.ok(point.x >= 550);
  assert.equal(land(point.x, point.y), true);
});

test('terrain presets preserve node types and place all centers on land', () => {
  const land = (x, y) => x >= 400;
  const nodes = placeTerrainNodes(makeDefaultNodes(), land);
  assert.deepEqual(nodes.map((node) => node.id), makeDefaultNodes().map((node) => node.id));
  assert.ok(nodes.every((node) => land(node.x, node.y)));
  assert.ok(nodes.every((node) => node.x >= 200 && node.x <= 900 && node.y >= 0 && node.y <= 700));
});

test('terrain corridors only connect the current centers and make no invented bridge claims', () => {
  const nodes = placeTerrainNodes(makeDefaultNodes(), () => true);
  const corridors = terrainConnections(nodes);
  assert.ok(corridors.length > 0);
  assert.ok(corridors.every((corridor) => corridor.bridgeSegment === null));
  assert.ok(corridors.every((corridor) => corridor.points[0].x === nodes.find((node) => node.id === corridor.from).x));
  assert.ok(corridors.length <= 6, 'the main-road preview is a sparse backbone');
  assert.ok(corridors.every((corridor) => !['park', 'residential', 'tourism'].includes(nodes.find((node) => node.id === corridor.from).type)));
});

test('terrain backbone separates shores when no crossing is identified', () => {
  const terrain = { width: 21, height: 11,
    land: Uint8Array.from({ length: 231 }, (_, i) => i % 21 === 10 ? 0 : 1),
    elevation: new Float32Array(231) };
  const nodes = [
    { id: 'cbd', type: 'cbd', x: 3, y: 4 },
    { id: 'landHub', type: 'landHub', x: 7, y: 4 },
    { id: 'industry', type: 'industry', x: 14, y: 4 },
    { id: 'seaHub', type: 'seaHub', x: 18, y: 4 },
  ];
  const corridors = terrainConnections(nodes, [], [], terrain, { originX: 0, mapSize: 21, maxDetour: 3 });
  assert.equal(corridors.length, 2);
  assert.ok(corridors.every((corridor) => corridor.points.every((point) => point.x !== 10)));
});
