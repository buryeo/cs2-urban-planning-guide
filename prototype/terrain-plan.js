import { routeOnTerrain, routeWithStructures } from './terrain-routes.js?v=7';

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

const CONNECTION_PURPOSES = Object.freeze({
  'cbd:landHub': [2.8, '城市中心与陆地枢纽之间的主要客流'],
  'industry:seaHub': [2.7, '工业区与港口之间的货运'],
  'industry:landHub': [2.4, '工业区与陆地枢纽之间的货运'],
  'airHub:cbd': [2.1, '航空枢纽与城市中心之间的客流'],
  'cbd:university': [1.9, '大学城与城市中心之间的日常出行'],
  'landHub:university': [1.5, '大学城与陆地枢纽之间的客流联系'],
  'cbd:industry': [1.3, '工业区与城市中心之间的联系'],
});

function connectionPurpose(from, to) {
  return CONNECTION_PURPOSES[[from.type, to.type].sort().join(':')] ?? [0.7, '为保持同岸中心连通的低优先级联系；需要人工复核用途'];
}

function networkDistance(corridors, start, end) {
  const distances = new Map([[start, 0]]);
  const pending = new Set([start]);
  while (pending.size) {
    const current = [...pending].reduce((best, id) => distances.get(id) < distances.get(best) ? id : best);
    pending.delete(current);
    if (current === end) return distances.get(current);
    for (const edge of corridors) {
      const next = edge.from === current ? edge.to : edge.to === current ? edge.from : null;
      if (!next) continue;
      const distance = distances.get(current) + edge.weight;
      if (distance < (distances.get(next) ?? Infinity)) {
        distances.set(next, distance);
        pending.add(next);
      }
    }
  }
  return Infinity;
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
    const landPoints = route(from, to);
    const engineered = terrain ? routeWithStructures(terrain, point(from), point(to), options) : null;
    const useEngineering = engineered && (!landPoints || length(engineered.points) < length(landPoints) * .78);
    const points = useEngineering ? engineered.points : landPoints;
    if (!points) continue;
    const id = `${from.id}-${to.id}`;
    const [priority, purpose] = connectionPurpose(from, to);
    const routeLength = length(points);
    const structures = useEngineering ? engineered.structures : [];
    const constructionCost = structures.reduce((total, part) => total + part.span * (part.kind === 'bridge' ? 1.5 : 2), 0);
    candidates.push({ id, from: from.id, to: to.id, points, bridgeSegment: null, structures,
      locked: locked.has(id), kind: 'main', weight: routeLength + constructionCost, priority, purpose,
      directLength: Math.hypot(from.x - to.x, from.y - to.y) });
  }
  candidates.sort((a, b) => Number(b.locked) - Number(a.locked) || a.weight / a.priority - b.weight / b.priority);
  const parent = new Map(anchors.map((node) => [node.id, node.id]));
  const root = (id) => {
    let current = id;
    while (parent.get(current) !== current) current = parent.get(current);
    return current;
  };
  const selected = [];
  for (const candidate of candidates) {
    const a = root(candidate.from); const b = root(candidate.to);
    if (a === b && !candidate.locked) continue;
    if (a !== b) parent.set(a, b);
    selected.push({ ...candidate, role: candidate.priority < 1.3 ? 'provisional' : 'primary' });
  }
  const selectedIds = new Set(selected.map((candidate) => candidate.id));
  const alternates = candidates.filter((candidate) => !selectedIds.has(candidate.id) && candidate.priority >= 1.5 &&
    candidate.directLength > 0 && candidate.weight <= candidate.directLength * 1.6)
    .map((candidate) => ({ ...candidate, gain: networkDistance(selected, candidate.from, candidate.to) / candidate.weight }))
    .filter((candidate) => Number.isFinite(candidate.gain) && candidate.gain >= 1.35)
    .sort((a, b) => b.gain - a.gain || a.weight - b.weight);
  if (alternates.length && anchors.length >= 4) selected.push({ ...alternates[0], role: 'alternate' });
  const result = selected.map(({ weight, priority, directLength, gain, ...corridor }) => corridor);
  const resource = nodes.find((node) => node.type === 'resource');
  const industry = nodes.find((node) => node.type === 'industry');
  if (resource && industry) {
    const points = route(industry, resource);
    if (points) result.push({ id: `${industry.id}-${resource.id}`, from: industry.id, to: resource.id,
      points, bridgeSegment: null, locked: locked.has(`${industry.id}-${resource.id}`), kind: 'freight',
      role: 'freight', purpose: '资源采集区与工业区之间的原料运输' });
  }
  return result;
}
