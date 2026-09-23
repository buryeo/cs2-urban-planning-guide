import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDefaultNodes, moveNode } from './planner.js';
import { makeDistricts, makeDistrictSubareas, polygonContains } from './districts.js';

test('each node becomes one bounded district that contains its center', () => {
  const nodes = makeDefaultNodes();
  const districts = makeDistricts(nodes);
  assert.equal(districts.length, nodes.length);
  for (const district of districts) {
    const node = nodes.find((item) => item.id === district.id);
    assert.ok(district.points.length >= 3, district.id);
    assert.ok(polygonContains(district.points, node), district.id);
    assert.ok(district.points.every(({ x, y }) => x >= 80 && x <= 1010 && y >= 50 && y <= 650), district.id);
  }
});

test('moving a center regenerates its district boundary', () => {
  const nodes = makeDefaultNodes();
  const original = makeDistricts(nodes).find((item) => item.id === 'cbd');
  const moved = makeDistricts(moveNode(nodes, 'cbd', 800, 300)).find((item) => item.id === 'cbd');
  assert.notDeepEqual(moved.points, original.points);
  assert.ok(polygonContains(moved.points, { x: 800, y: 300 }));
});

test('a larger node influence claims more of a shared boundary', () => {
  const nodes = [
    { id: 'a', type: 'park', x: 300, y: 300, radius: 40 },
    { id: 'b', type: 'park', x: 500, y: 300, radius: 40 },
  ];
  const middle = makeDistricts(nodes).find((item) => item.id === 'a');
  const enlarged = makeDistricts([{ ...nodes[0], radius: 80 }, nodes[1]]).find((item) => item.id === 'a');
  assert.ok(Math.max(...enlarged.points.map((p) => p.x)) > Math.max(...middle.points.map((p) => p.x)));
});

test('large districts split into smaller land planning areas', () => {
  const districts = makeDistricts(makeDefaultNodes());
  const subareas = makeDistrictSubareas(districts, makeDefaultNodes());
  assert.ok(subareas.length > districts.length * 2);
  for (const subarea of subareas) {
    const parent = districts.find((item) => item.id === subarea.parentId);
    assert.ok(subarea.points.length >= 3);
    assert.ok(subarea.points.every((point) => polygonContains(parent.points, point)));
  }
});
