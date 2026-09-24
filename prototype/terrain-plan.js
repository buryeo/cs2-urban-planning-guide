import { routeOnTerrain } from './terrain-routes.js?v=5';

export const TERRAIN_RECT = Object.freeze({ left: 200, right: 900, top: 0, bottom: 700 });

export function imagePoint(u, v) {
  return { x: Math.round(TERRAIN_RECT.left + u * 700), y: Math.round(v * 700) };
}

export function isWaterColor(red, green, blue) {
  return blue > red + 25 && blue > green + 10;
}

export function nearestLandPoint(point, isLand, bounds = TERRAIN_RECT) {
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const origin = { x: clamp(Math.round(point.x), bounds.left, bounds.right), y: clamp(Math.round(point.y), bounds.top, bounds.bottom) };
  if (isLand(origin.x, origin.y)) return origin;
  for (let radius = 8; radius <= 520; radius += 8) {
    const count = Math.max(16, Math.ceil(radius * Math.PI / 5));
    for (let index = 0; index < count; index++) {
      const angle = index * Math.PI * 2 / count;
      const x = clamp(Math.round(origin.x + radius * Math.cos(angle)), bounds.left, bounds.right);
      const y = clamp(Math.round(origin.y + radius * Math.sin(angle)), bounds.top, bounds.bottom);
      if (isLand(x, y)) return { x, y };
    }
  }
  return origin;
}

const ANCHORS = Object.freeze({
  cbd: [.60, .49], landHub: [.67, .64], airHub: [.76, .86], seaHub: [.54, .52],
  industry: [.70, .78], resource: [.77, .79],
  residential: [.43, .54], 'residential-2': [.38, .42],
  'residential-3': [.66, .42], 'residential-4': [.61, .73],
  'park-1': [.34, .59], 'park-2': [.77, .53],
  tourism: [.43, .72], university: [.55, .65], research: [.61, .65],
});

export function placeTerrainNodes(nodes, isLand) {
  return nodes.map((node) => {
    const anchor = ANCHORS[node.id] ?? [.5, .5];
    return { ...node, ...nearestLandPoint(imagePoint(...anchor), isLand) };
  });
}

export function terrainConnections(nodes, previous = [], lockedIds = [], terrain = null, options = {}) {
  const anchors = nodes.filter((node) => ['cbd', 'landHub', 'airHub', 'seaHub', 'industry', 'university'].includes(node.type));
  const locked = new Set(lockedIds);
  const point = (node) => ({ x: node.x, y: node.y });
  const route = (from, to) => terrain
    ? routeOnTerrain(terrain, point(from), point(to), options)
    : [point(from), point(to)];
  const length = (points) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);
  const candidates = [];
  for (let i = 0; i < anchors.length; i++) for (let j = i + 1; j < anchors.length; j++) {
    const from = anchors[i]; const to = anchors[j];
    const points = route(from, to);
    if (!points) continue;
    const id = `${from.id}-${to.id}`;
    candidates.push({ id, from: from.id, to: to.id, points, bridgeSegment: null,
      locked: locked.has(id), kind: 'main', weight: length(points) });
  }
  candidates.sort((a, b) => Number(b.locked) - Number(a.locked) || a.weight - b.weight);
  const parent = new Map(anchors.map((node) => [node.id, node.id]));
  const root = (id) => {
    let current = id;
    while (parent.get(current) !== current) current = parent.get(current);
    return current;
  };
  const result = [];
  for (const candidate of candidates) {
    const a = root(candidate.from); const b = root(candidate.to);
    if (a === b) continue;
    parent.set(a, b);
    const { weight, ...corridor } = candidate;
    result.push(corridor);
  }
  const resource = nodes.find((node) => node.type === 'resource');
  const industry = nodes.find((node) => node.type === 'industry');
  if (resource && industry) {
    const points = route(industry, resource);
    if (points) result.push({ id: `${industry.id}-${resource.id}`, from: industry.id, to: resource.id,
      points, bridgeSegment: null, locked: locked.has(`${industry.id}-${resource.id}`), kind: 'freight' });
  }
  return result;
}
