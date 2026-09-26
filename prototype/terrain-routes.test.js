import test from 'node:test';
import assert from 'node:assert/strict';
import { routeOnTerrain, routeViaPoint, routeWithStructures, softenTerrainRoute, designTerrainRoute, findTightTurns } from './terrain-routes.js';

const grid = (width, height, blocked = () => false) => ({
  width, height,
  land: Uint8Array.from({ length: width * height }, (_, i) => blocked(i % width, Math.floor(i / width)) ? 0 : 1),
  elevation: new Float32Array(width * height),
});

test('terrain route uses a dry gap instead of drawing across water', () => {
  const terrain = grid(11, 9, (x, y) => x === 5 && y !== 4);
  const points = routeOnTerrain(terrain, { x: 2, y: 2 }, { x: 8, y: 2 }, { originX: 0, mapSize: 11, maxDetour: 3 });
  assert.ok(points);
  assert.deepEqual(points[0], { x: 2, y: 2 });
  assert.deepEqual(points.at(-1), { x: 8, y: 2 });
  const cell = (point) => ({ x: Math.floor(point.x), y: Math.floor(point.y * 9 / 11) });
  assert.ok(points.some((point) => cell(point).x === 5 && cell(point).y === 4));
  assert.ok(points.every((point) => terrain.land[cell(point).y * 11 + cell(point).x]));
});

test('terrain route leaves disconnected shores without a road', () => {
  const terrain = grid(11, 9, (x) => x === 5);
  assert.equal(routeOnTerrain(terrain, { x: 2, y: 2 }, { x: 8, y: 2 }, { originX: 0, mapSize: 11 }), null);
});

test('a short water gap can become an explicitly marked bridge candidate', () => {
  const terrain = grid(21, 21, (x) => x === 10);
  const candidate = routeWithStructures(terrain, { x: 3, y: 10 }, { x: 17, y: 10 },
    { originX: 0, mapSize: 21, maxBridge: 4 });
  assert.ok(candidate);
  assert.equal(candidate.structures.length, 1);
  assert.equal(candidate.structures[0].kind, 'bridge');
  assert.deepEqual(candidate.points, [{ x: 3, y: 10 }, { x: 17, y: 10 }]);
});

test('a water crossing longer than the bridge limit is rejected', () => {
  const terrain = grid(21, 21, (x) => x >= 7 && x <= 13);
  assert.equal(routeWithStructures(terrain, { x: 3, y: 10 }, { x: 17, y: 10 },
    { originX: 0, mapSize: 21, maxBridge: 4 }), null);
});

test('a short impassable ridge can become an explicitly marked tunnel candidate', () => {
  const terrain = grid(21, 21);
  for (let y = 0; y < 21; y++) terrain.elevation[y * 21 + 10] = 100;
  const candidate = routeWithStructures(terrain, { x: 3, y: 10 }, { x: 17, y: 10 },
    { originX: 0, mapSize: 21, metersPerCell: 20, maxTunnel: 5 });
  assert.ok(candidate);
  assert.equal(candidate.structures[0].kind, 'tunnel');
});

test('gentle route avoids a steep but passable shortcut', () => {
  const terrain = grid(15, 9);
  for (let y = 3; y <= 5; y++) for (let x = 5; x <= 9; x++) terrain.elevation[y * 15 + x] = 1;
  const start = { x: 1, y: 7 };
  const end = { x: 13, y: 7 };
  const settings = { originX: 0, mapSize: 15, metersPerCell: 20, maxGrade: .18, maxDetour: 3 };
  const short = routeOnTerrain(terrain, start, end, { ...settings, gradeWeight: 0 });
  const gentle = routeOnTerrain(terrain, start, end, { ...settings, gradeWeight: 100 });
  assert.ok(short.some((point) => point.x >= 5 && point.x <= 9 && point.y >= 5 && point.y < 10));
  assert.ok(gentle.every((point) => !(point.x >= 5 && point.x <= 9 && point.y >= 5 && point.y < 10)));
});

test('a chosen waypoint becomes part of a continuous land route', () => {
  const terrain = grid(11, 11);
  const via = { x: 5, y: 8 };
  const points = routeViaPoint(terrain, { x: 1, y: 1 }, via, { x: 9, y: 1 }, { originX: 0, mapSize: 11 });
  assert.ok(points);
  assert.deepEqual(points[0], { x: 1, y: 1 });
  assert.deepEqual(points.at(-1), { x: 9, y: 1 });
  assert.ok(points.some((point) => point.x === via.x && point.y === via.y));
});

test('a waypoint on an impassable slope is rejected instead of silently snapped', () => {
  const terrain = grid(11, 11);
  terrain.elevation[5 * 11 + 5] = 10;
  const points = routeViaPoint(terrain, { x: 1, y: 5 }, { x: 5, y: 5 }, { x: 9, y: 5 },
    { originX: 0, mapSize: 11, metersPerCell: 20 });
  assert.equal(points, null);
});

test('softening rounds a land corner without crossing water', () => {
  const terrain = grid(9, 9, (x, y) => x === 4 && y <= 5);
  const raw = [{ x: 2, y: 4 }, { x: 2, y: 6 }, { x: 6, y: 6 }];
  const points = softenTerrainRoute(terrain, raw, { originX: 0, mapSize: 9 });
  assert.deepEqual(points[0], raw[0]);
  assert.deepEqual(points.at(-1), raw.at(-1));
  assert.ok(points.length > raw.length);
  assert.ok(points.every((point) => !(point.x >= 4 && point.x < 5 && point.y < 6)));
});

test('flat-ground zigzags collapse into one clean alignment', () => {
  const terrain = grid(9, 9);
  const points = softenTerrainRoute(terrain,
    [{ x: 1, y: 1 }, { x: 3, y: 2 }, { x: 5, y: 1 }, { x: 7, y: 1 }],
    { originX: 0, mapSize: 9 });
  assert.ok(points.every((point) => Math.abs(point.y - 1) < .1));
});

test('a road around a broad water obstacle leaves room for a smoother turn', () => {
  const terrain = grid(40, 40, (x, y) => x >= 12 && x <= 27 && y <= 22);
  const settings = { originX: 0, mapSize: 40, maxDetour: 5 };
  const raw = routeOnTerrain(terrain, { x: 5, y: 10 }, { x: 35, y: 10 },
    { ...settings, clearanceWeight: 0 });
  const spaced = routeOnTerrain(terrain, { x: 5, y: 10 }, { x: 35, y: 10 },
    { ...settings, clearanceWeight: 3 });
  const baseline = softenTerrainRoute(terrain, raw, settings);
  const rounded = softenTerrainRoute(terrain, spaced, { ...settings, softenClearance: 1 });
  assert.ok(findTightTurns(rounded).length < findTightTurns(baseline).length);
  assert.ok(rounded.every((point) => !(point.x >= 12 && point.x < 28 && point.y <= 22)));
});

test('route design follows a waypoint while preserving connection endpoints', () => {
  const terrain = grid(11, 11);
  const corridor = { id: 'a-b', from: 'a', to: 'b', points: [{ x: 1, y: 1 }, { x: 9, y: 1 }] };
  const nodes = [{ id: 'a', x: 1, y: 1 }, { id: 'b', x: 9, y: 1 }];
  const result = designTerrainRoute(terrain, corridor, nodes, { mode: 'short', via: { x: 5, y: 8 } }, { originX: 0, mapSize: 11 });
  assert.equal(result.warning, null);
  assert.deepEqual(result.points[0], { x: nodes[0].x, y: nodes[0].y });
  assert.deepEqual(result.points.at(-1), { x: nodes[1].x, y: nodes[1].y });
  assert.ok(result.points.some((point) => point.x > 4 && point.x < 6 && point.y > 7));
  assert.ok(result.points.some((point) => point.x === 5 && point.y === 8));
});

test('invalid waypoint keeps the previous safe route and explains why', () => {
  const terrain = grid(11, 11, (x) => x >= 4 && x <= 6);
  const corridor = { id: 'a-b', from: 'a', to: 'b', points: [{ x: 1, y: 1 }, { x: 2, y: 1 }] };
  const nodes = [{ id: 'a', x: 1, y: 1 }, { id: 'b', x: 2, y: 1 }];
  const result = designTerrainRoute(terrain, corridor, nodes, { via: { x: 9, y: 1 } }, { originX: 0, mapSize: 11 });
  assert.ok(result.warning);
  assert.deepEqual(result.points[0], corridor.points[0]);
  assert.deepEqual(result.points.at(-1), corridor.points.at(-1));
});

test('switching a bridge candidate back to land routing clears its structure marker', () => {
  const terrain = grid(21, 21, (x, y) => x === 10 && y < 12);
  const nodes = [{ id: 'a', x: 3, y: 10 }, { id: 'b', x: 17, y: 10 }];
  const corridor = { id: 'a-b', from: 'a', to: 'b', points: [nodes[0], nodes[1]],
    structures: [{ kind: 'bridge', from: { x: 9, y: 10 }, to: { x: 11, y: 10 }, span: 2 }] };
  const result = designTerrainRoute(terrain, corridor, nodes, { mode: 'balanced' },
    { originX: 0, mapSize: 21, maxDetour: 3 });
  assert.equal(result.warning, null);
  assert.deepEqual(result.structures, []);
  assert.ok(result.points.some((point) => point.y >= 12));
});

test('engineering mode marks a short tunnel and preserves a straight alignment', () => {
  const terrain = grid(21, 21);
  for (let y = 0; y < 21; y++) terrain.elevation[y * 21 + 10] = 100;
  const nodes = [{ id: 'a', x: 3, y: 10 }, { id: 'b', x: 17, y: 10 }];
  const corridor = { id: 'a-b', from: 'a', to: 'b', points: [nodes[0], nodes[1]], structures: [] };
  const result = designTerrainRoute(terrain, corridor, nodes, { mode: 'engineering' },
    { originX: 0, mapSize: 21, metersPerCell: 20 });
  assert.equal(result.warning, null);
  assert.equal(result.structures[0].kind, 'tunnel');
  assert.deepEqual(result.points, [nodes[0], nodes[1]]);
});

test('bend hints flag an abrupt turn but not a straight corridor', () => {
  assert.ok(findTightTurns([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }], 10).length > 0);
  assert.deepEqual(findTightTurns([{ x: 0, y: 0 }, { x: 10, y: 1 }, { x: 20, y: 2 }], 10), []);
});
