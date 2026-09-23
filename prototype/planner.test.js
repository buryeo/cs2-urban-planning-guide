import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeDefaultNodes,
  moveNode,
  generateCorridors,
  makeStreetSegments,
  getNodeAdvisories,
  isWater,
  isDownwind,
  recommendIndustryPosition,
  recommendResourcePosition,
  distanceToShippingChannel,
} from './planner.js';

test('the first suggestion contains every requested node and two separate parks', () => {
  const nodes = makeDefaultNodes();
  assert.equal(nodes.length, 15);
  assert.equal(nodes.filter((node) => node.type === 'residential').length, 4);
  assert.equal(nodes.filter((node) => node.type === 'park').length, 2);
  assert.equal(new Set(nodes.map((node) => node.id)).size, nodes.length);
  for (const type of ['cbd', 'landHub', 'airHub', 'seaHub', 'industry', 'resource', 'residential', 'tourism', 'university', 'research']) {
    assert.ok(nodes.some((node) => node.type === type), `${type} is present`);
  }
  assert.ok(!nodes.some((node) => node.type === 'community'));
  assert.ok(nodes.every((node) => !isWater(node.x, node.y)), 'default node centers stay on land');
  assert.ok(isDownwind(nodes.find((node) => node.type === 'industry'), nodes, 'NW'));
  assert.ok(distanceToShippingChannel(nodes.find((node) => node.type === 'seaHub')) < 85);
  assert.ok(Math.hypot(
    nodes.find((node) => node.type === 'resource').x - nodes.find((node) => node.type === 'industry').x,
    nodes.find((node) => node.type === 'resource').y - nodes.find((node) => node.type === 'industry').y,
  ) <= 130, 'resource center is close to industry');
});

test('dragging a node changes a copy and keeps it inside the planning area', () => {
  const original = makeDefaultNodes();
  const moved = moveNode(original, 'cbd', -500, 900);
  assert.notEqual(moved, original);
  assert.equal(original.find((node) => node.id === 'cbd').x, 750);
  assert.deepEqual(
    [moved.find((node) => node.id === 'cbd').x, moved.find((node) => node.id === 'cbd').y],
    [110, 620],
  );
});

test('a cross-river main connection uses a marked bridge', () => {
  const corridors = generateCorridors(makeDefaultNodes());
  const crossRiver = corridors.find((corridor) => corridor.id === 'landHub-cbd');
  assert.equal(crossRiver.points.length, 4);
  assert.deepEqual(crossRiver.bridgeSegment, [1, 2]);
  assert.ok(crossRiver.points[1].x < crossRiver.points[2].x);
});

test('the park to delta attraction connection marks its distributary bridge', () => {
  const corridor = generateCorridors(makeDefaultNodes()).find((item) => item.id === 'park-2-tourism');
  assert.deepEqual(corridor.bridgeSegment, [1, 2]);
  assert.equal(corridor.points.length, 4);
  assert.ok(corridor.points[1].y < corridor.points[2].y);
});

test('regeneration keeps a locked crossing while updating its node endpoints', () => {
  const nodes = makeDefaultNodes();
  const before = generateCorridors(nodes, 0);
  const changedNodes = moveNode(nodes, 'cbd', 800, 300);
  const after = generateCorridors(changedNodes, 1, before, ['landHub-cbd']);
  const previous = before.find((corridor) => corridor.id === 'landHub-cbd');
  const locked = after.find((corridor) => corridor.id === 'landHub-cbd');
  assert.deepEqual(locked.points.slice(1, -1), previous.points.slice(1, -1));
  assert.deepEqual(locked.points.at(-1), { x: 800, y: 300 });
  assert.equal(locked.locked, true);
});

test('wind changes find an on-land downwind industry site', () => {
  const nodes = makeDefaultNodes();
  for (const direction of ['NW', 'NE', 'SW', 'SE']) {
    const site = recommendIndustryPosition(nodes, direction);
    assert.ok(!isWater(site.x, site.y), `${direction}: dry site`);
    assert.ok(isDownwind(site, nodes, direction), `${direction}: downwind site`);
  }
});

test('each wind recommendation keeps resource extraction near industry on land', () => {
  const nodes = makeDefaultNodes();
  for (const direction of ['NW', 'NE', 'SW', 'SE']) {
    const industry = recommendIndustryPosition(nodes, direction);
    const resource = recommendResourcePosition(nodes, industry);
    assert.ok(!isWater(resource.x, resource.y), `${direction}: resource is dry`);
    assert.ok(Math.hypot(resource.x - industry.x, resource.y - industry.y) <= 130, `${direction}: short freight trip`);
  }
});

test('resource placement advice flags a long freight distance', () => {
  const nodes = makeDefaultNodes();
  const farResource = { ...nodes.find((node) => node.type === 'resource'), x: 160, y: 105 };
  const changed = nodes.map((node) => node.type === 'resource' ? farResource : node);
  assert.ok(getNodeAdvisories(farResource, changed).some((item) => item.kind === 'freight'));
  assert.ok(getNodeAdvisories(changed.find((node) => node.type === 'industry'), changed).some((item) => item.kind === 'freight'));
});

test('default freight corridor connects resource directly with industry', () => {
  const corridors = generateCorridors(makeDefaultNodes());
  assert.ok(corridors.some((item) => item.id === 'resource-industry'));
  assert.ok(!corridors.some((item) => item.id === 'resource-landHub'));
});

test('industry and maritime hub advisories reflect wind and channel access', () => {
  const nodes = makeDefaultNodes();
  const industry = nodes.find((node) => node.type === 'industry');
  assert.ok(getNodeAdvisories(industry, nodes, 'SE').some((item) => item.kind === 'wind'));
  const seaHub = { ...nodes.find((node) => node.type === 'seaHub'), x: 280, y: 250 };
  assert.ok(getNodeAdvisories(seaHub, nodes, 'NW').some((item) => item.kind === 'shipping'));
});

test('a newly added district joins the nearest existing node', () => {
  const nodes = makeDefaultNodes();
  nodes.push({ id: 'park-3', type: 'park', x: 835, y: 530, radius: 40, locked: false });
  const corridors = generateCorridors(nodes);
  assert.ok(corridors.some((corridor) => corridor.from === 'park-3' || corridor.to === 'park-3'));
});

test('higher street density adds local streets without changing the nodes', () => {
  const nodes = makeDefaultNodes();
  const sparse = makeStreetSegments(nodes, 1);
  const dense = makeStreetSegments(nodes, 3);
  assert.ok(dense.length > sparse.length);
  assert.equal(nodes[0].x, 750);
});

test('parks keep fewer local paths than residential areas', () => {
  const segments = makeStreetSegments(makeDefaultNodes(), 2);
  const parkCount = segments.filter((segment) => segment.nodeId === 'park-1').length;
  const homesCount = segments.filter((segment) => segment.nodeId === 'residential').length;
  assert.ok(parkCount < homesCount);
});

test('terrain advice identifies a node placed in the river', () => {
  const nodes = makeDefaultNodes();
  const riverNode = moveNode(nodes, 'cbd', 590, 350);
  assert.equal(isWater(590, 350), true);
  assert.ok(getNodeAdvisories(riverNode.find((node) => node.id === 'cbd'), riverNode).some((item) => item.kind === 'water'));
});
