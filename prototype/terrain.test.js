import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDefaultNodes } from './planner.js';
import { makeWaterPolygons, waterAt } from './terrain.js';

test('the estuary has several irregular connected water forms', () => {
  const polygons = makeWaterPolygons();
  assert.ok(polygons.length >= 5);
  assert.ok(polygons[0].length > 80, 'main river has a detailed shoreline');
  assert.ok(waterAt(590, 350), 'main channel');
  assert.ok(waterAt(850, 535), 'navigable distributary');
  assert.ok(waterAt(1060, 350), 'sea edge');
});

test('suggested centers remain on land after shoreline refinement', () => {
  for (const node of makeDefaultNodes()) {
    assert.equal(waterAt(node.x, node.y), false, node.id);
  }
});
