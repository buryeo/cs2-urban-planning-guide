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
  assert.ok(corridors.length <= 7, 'the preview keeps a sparse backbone with at most one alternate road');
  assert.ok(corridors.every((corridor) => !['park', 'residential', 'tourism'].includes(nodes.find((node) => node.id === corridor.from).type)));
});

test('terrain backbone marks a short cross-water connection as a bridge candidate', () => {
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
  assert.ok(corridors.some((corridor) => corridor.structures?.some((part) => part.kind === 'bridge')));
  assert.ok(corridors.every((corridor) => corridor.structures?.every((part) => part.span <= 45)));
});

test('terrain corridors favor useful center relationships and add one short alternate connection', () => {
  const nodes = [
    { id: 'landHub', type: 'landHub', x: 0, y: 0 },
    { id: 'cbd', type: 'cbd', x: 10, y: 0 },
    { id: 'university', type: 'university', x: 10, y: 10 },
    { id: 'airHub', type: 'airHub', x: 20, y: 0 },
    { id: 'industry', type: 'industry', x: 0, y: 10 },
    { id: 'seaHub', type: 'seaHub', x: -10, y: 10 },
    { id: 'resource', type: 'resource', x: -3, y: 13 },
  ];
  const corridors = terrainConnections(nodes);
  const pair = (a, b) => corridors.find((item) => [item.from, item.to].sort().join(':') === [a, b].sort().join(':'));
  for (const [a, b] of [['landHub', 'cbd'], ['industry', 'seaHub'], ['industry', 'landHub'], ['cbd', 'airHub'], ['cbd', 'university']]) {
    assert.ok(pair(a, b), `${a}–${b} should be connected`);
    assert.equal(pair(a, b).role, 'primary');
    assert.ok(pair(a, b).purpose);
  }
  assert.equal(pair('landHub', 'university')?.role, 'alternate');
  assert.equal(pair('industry', 'resource')?.kind, 'freight');
});

test('locked relationship is retained when the new connection policy recomputes', () => {
  const nodes = [
    { id: 'cbd', type: 'cbd', x: 0, y: 0 },
    { id: 'landHub', type: 'landHub', x: 10, y: 0 },
    { id: 'airHub', type: 'airHub', x: 20, y: 0 },
  ];
  const corridors = terrainConnections(nodes, [], ['cbd-airHub']);
  assert.equal(corridors.find((item) => item.id === 'cbd-airHub')?.locked, true);
});

test('a fallback link between unrelated centers is marked for manual review', () => {
  const nodes = [
    { id: 'industry', type: 'industry', x: 0, y: 0 },
    { id: 'university', type: 'university', x: 10, y: 0 },
  ];
  const [corridor] = terrainConnections(nodes);
  assert.equal(corridor.role, 'provisional');
  assert.match(corridor.purpose, /人工复核/);
});
