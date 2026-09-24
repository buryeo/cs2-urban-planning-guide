import { riverX, northBranchY, waterAt } from './terrain.js';
export { riverX, northBranchY } from './terrain.js';

export const MAP_BOUNDS = Object.freeze({ minX: 110, maxX: 970, minY: 70, maxY: 620 });

export const NODE_TYPES = Object.freeze([
  { type: 'cbd', name: 'CBD / 城市中心', short: 'CBD', color: '#d58a52', reason: '靠近主要跨河通道与商业节点，形成可步行到达的复合中心。' },
  { type: 'landHub', name: '陆地交通枢纽', short: '陆枢', color: '#597d9c', reason: '靠近外部道路入口，组织公路与轨道交通换乘。' },
  { type: 'airHub', name: '航空枢纽', short: '空港', color: '#7588b4', reason: '预留较完整的平地，并核实实际游戏地图的机场用地与净空。' },
  { type: 'seaHub', name: '海运枢纽', short: '海港', color: '#4d91aa', reason: '靠近可航行的水道；港口位置须再核实航道、水深与岸线条件。' },
  { type: 'industry', name: '工业区', short: '工业', color: '#8b8f78', reason: '优先布置在城市中心的下风侧，并为货运保留不穿越居住区的连接。' },
  { type: 'resource', name: '资源采集区', short: '资源', color: '#a98f62', reason: '先靠近工业区，缩短原料货运；真正资源位置仍须由游戏资源图层核实。' },
  { type: 'residential', name: '居住中心', short: '居住', color: '#b77978', reason: '与陆地交通枢纽、公园和日常服务形成短距离联系。' },
  { type: 'park', name: '公园区', short: '公园', color: '#6f9b7c', reason: '保留开敞空间，位置可按景观与步行可达性调整。' },
  { type: 'tourism', name: '旅游景点区', short: '景点', color: '#9a81a7', reason: '借河口与岛屿景观形成目的地，但不占用主要交通走廊。' },
  { type: 'university', name: '大学城', short: '大学', color: '#7d8db4', reason: '与居住、公园和科研中心相邻，适合安排慢行联系。' },
  { type: 'research', name: '科研中心', short: '科研', color: '#7198a4', reason: '靠近大学城，并留有连接 CBD 的通道。' },
]);

const DEFAULT_NODES = [
  ['cbd', 'cbd', 750, 245, 56],
  ['landHub', 'landHub', 360, 290, 52],
  ['airHub', 'airHub', 880, 130, 39],
  ['seaHub', 'seaHub', 945, 515, 38],
  ['industry', 'industry', 910, 400, 47],
  ['resource', 'resource', 930, 310, 41],
  ['residential', 'residential', 285, 440, 61],
  ['residential-2', 'residential', 290, 205, 48],
  ['residential-3', 'residential', 700, 150, 49],
  ['residential-4', 'residential', 770, 575, 51],
  ['park-1', 'park', 465, 375, 44],
  ['park-2', 'park', 745, 410, 43],
  ['tourism', 'tourism', 925, 600, 38],
  ['university', 'university', 340, 565, 48],
  ['research', 'research', 470, 560, 42],
];

const CONNECTIONS = [
  ['resource', 'industry'], ['industry', 'seaHub'], ['industry', 'cbd'],
  ['landHub', 'cbd'], ['landHub', 'residential'], ['residential', 'university'],
  ['landHub', 'residential-2'], ['residential-2', 'park-1'],
  ['residential-3', 'cbd'], ['residential-3', 'airHub'],
  ['residential-4', 'tourism'], ['residential-4', 'park-2'],
  ['university', 'research'], ['research', 'cbd'],
  ['cbd', 'airHub'], ['park-2', 'tourism'],
  ['cbd', 'park-1'], ['cbd', 'park-2'],
];

export const WIND_DIRECTIONS = Object.freeze([
  { id: 'NW', name: '西北风', from: '西北', to: '东南', dx: 1, dy: 1 },
  { id: 'NE', name: '东北风', from: '东北', to: '西南', dx: -1, dy: 1 },
  { id: 'SW', name: '西南风', from: '西南', to: '东北', dx: 1, dy: -1 },
  { id: 'SE', name: '东南风', from: '东南', to: '西北', dx: -1, dy: -1 },
]);

const INDUSTRY_SITES = Object.freeze({
  NW: { x: 910, y: 400 }, NE: { x: 190, y: 570 },
  SW: { x: 950, y: 85 }, SE: { x: 300, y: 105 },
});

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const point = (node) => ({ x: node.x, y: node.y });

export function getNodeType(type) {
  return NODE_TYPES.find((item) => item.type === type);
}

export function makeDefaultNodes() {
  return DEFAULT_NODES.map(([id, type, x, y, radius]) => ({ id, type, x, y, radius, shape: 'circle', angle: 0, locked: false }));
}

export function moveNode(nodes, id, x, y) {
  return nodes.map((node) => node.id === id && !node.locked
    ? { ...node, x: clamp(Math.round(x), MAP_BOUNDS.minX, MAP_BOUNDS.maxX), y: clamp(Math.round(y), MAP_BOUNDS.minY, MAP_BOUNDS.maxY) }
    : node);
}

export function resizeNode(nodes, id, radius) {
  return nodes.map((node) => node.id === id && !node.locked
    ? { ...node, radius: clamp(Math.round(radius), 16, 88) }
    : node);
}

export function isWater(x, y) {
  return waterAt(x, y);
}

export function isDownwind(node, nodes, wind = 'NW') {
  const core = nodes.find((item) => item.type === 'cbd');
  const direction = WIND_DIRECTIONS.find((item) => item.id === wind) ?? WIND_DIRECTIONS[0];
  if (!core) return false;
  const dx = node.x - core.x;
  const dy = node.y - core.y;
  const along = (dx * direction.dx + dy * direction.dy) / Math.SQRT2;
  const across = Math.abs(dx * direction.dy - dy * direction.dx) / Math.SQRT2;
  return along >= 100 && across <= Math.max(130, along * 1.1);
}

export function recommendIndustryPosition(nodes, wind = 'NW') {
  const candidate = INDUSTRY_SITES[wind] ?? INDUSTRY_SITES.NW;
  return { ...candidate };
}

export function recommendResourcePosition(nodes, industrySite) {
  const offsets = [[20, -90], [-80, 0], [20, 90], [90, 0], [-70, -65], [-70, 65]];
  const candidates = offsets.map(([dx, dy]) => ({
    x: clamp(industrySite.x + dx, MAP_BOUNDS.minX, MAP_BOUNDS.maxX),
    y: clamp(industrySite.y + dy, MAP_BOUNDS.minY, MAP_BOUNDS.maxY),
  }));
  const sensitive = nodes.filter((node) => ['residential', 'airHub', 'cbd', 'university'].includes(node.type));
  return candidates.find((site) => !isWater(site.x, site.y)
    && Math.hypot(site.x - industrySite.x, site.y - industrySite.y) >= 75
    && sensitive.every((node) => Math.hypot(site.x - node.x, site.y - node.y) >= 95))
    ?? candidates.find((site) => !isWater(site.x, site.y))
    ?? { x: industrySite.x, y: industrySite.y };
}

export function distanceToShippingChannel(node) {
  // Conceptual navigable branch: the actual in-game shipping routes need verification.
  const a = { x: 650, y: northBranchY(650) };
  const b = { x: 1040, y: northBranchY(1040) };
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const t = clamp(((node.x - a.x) * vx + (node.y - a.y) * vy) / (vx * vx + vy * vy), 0, 1);
  return Math.hypot(node.x - (a.x + vx * t), node.y - (a.y + vy * t));
}

export function generateCorridors(nodes, variant = 0, previous = [], lockedIds = []) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const oldById = new Map(previous.map((corridor) => [corridor.id, corridor]));
  const locks = new Set(lockedIds);
  const defaultIds = new Set(DEFAULT_NODES.map(([id]) => id));
  const extraConnections = nodes.filter((node) => !defaultIds.has(node.id)).flatMap((node) => {
    const nearest = nodes.filter((other) => other.id !== node.id)
      .sort((a, b) => Math.hypot(a.x - node.x, a.y - node.y) - Math.hypot(b.x - node.x, b.y - node.y))[0];
    return nearest ? [[node.id, nearest.id]] : [];
  });
  return [...CONNECTIONS, ...extraConnections].flatMap(([from, to]) => {
    const start = byId.get(from);
    const end = byId.get(to);
    if (!start || !end) return [];
    const id = `${from}-${to}`;
    const old = oldById.get(id);
    if (locks.has(id) && old) {
      return [{ ...old, points: [point(start), ...old.points.slice(1, -1), point(end)], locked: true }];
    }
    const startWest = start.x < riverX(start.y);
    const endWest = end.x < riverX(end.y);
    if (startWest !== endWest) {
      const eastNode = startWest ? end : start;
      const staysNorth = eastNode.y < northBranchY(eastNode.x) - 25;
      const crossingY = staysNorth ? 300 + (variant % 2) * 25 : 500 - (variant % 2) * 22;
      const west = { x: Math.round(riverX(crossingY) - 48), y: crossingY };
      const east = { x: Math.round(riverX(crossingY) + 48), y: crossingY };
      return [{
        id, from, to,
        points: [point(start), startWest ? west : east, startWest ? east : west, point(end)],
        bridgeSegment: [1, 2], locked: false,
      }];
    }
    if (start.x > 650 && end.x > 650 && (start.y < northBranchY(start.x)) !== (end.y < northBranchY(end.x))) {
      const bridgeX = Math.round((start.x + end.x) / 2);
      const bridgeY = Math.round(northBranchY(bridgeX));
      const north = { x: bridgeX, y: bridgeY - 32 };
      const south = { x: bridgeX, y: bridgeY + 32 };
      const startNorth = start.y < northBranchY(start.x);
      return [{
        id, from, to,
        points: [point(start), startNorth ? north : south, startNorth ? south : north, point(end)],
        bridgeSegment: [1, 2], locked: false,
      }];
    }
    return [{ id, from, to, points: [point(start), point(end)], bridgeSegment: null, locked: false }];
  });
}

const ORIENTATIONS = {
  cbd: 28, landHub: -13, airHub: 0, seaHub: 0, industry: 0, resource: -20, residential: 16,
  park: 35, tourism: -30, university: 7, research: 18,
};

export function makeStreetSegments(nodes, density = 2) {
  const level = clamp(Math.round(density), 1, 3);
  const lines = [];
  const xy = (x, y) => `${x.toFixed(1)} ${y.toFixed(1)}`;
  const add = (node, d) => lines.push({ nodeId: node.id, d });
  for (const node of nodes) {
    if (node.type === 'resource') continue;
    if (node.type === 'park') {
      for (let index = 0; index < Math.ceil(level / 2) + 1; index++) {
        const radius = node.radius * (0.62 + index * 0.32);
        add(node, `M ${xy(node.x - radius, node.y)} A ${radius.toFixed(1)} ${(radius * .8).toFixed(1)} 0 1 0 ${xy(node.x + radius, node.y)} A ${radius.toFixed(1)} ${(radius * .8).toFixed(1)} 0 1 0 ${xy(node.x - radius, node.y)}`);
      }
      add(node, `M ${xy(node.x - node.radius * 1.2, node.y + node.radius * .42)} Q ${xy(node.x, node.y - node.radius * .48)} ${xy(node.x + node.radius * 1.1, node.y - node.radius * .62)}`);
      add(node, `M ${xy(node.x - node.radius * .43, node.y - node.radius * 1.13)} Q ${xy(node.x + node.radius * .4, node.y)} ${xy(node.x + node.radius * .58, node.y + node.radius * 1.04)}`);
      continue;
    }
    if (node.type === 'cbd') {
      for (const multiplier of level === 1 ? [.8] : [.72, 1.22]) {
        const radius = node.radius * multiplier;
        add(node, `M ${xy(node.x - radius, node.y)} A ${radius.toFixed(1)} ${radius.toFixed(1)} 0 1 0 ${xy(node.x + radius, node.y)} A ${radius.toFixed(1)} ${radius.toFixed(1)} 0 1 0 ${xy(node.x - radius, node.y)}`);
      }
      const spokeCount = 4 + level * 2;
      for (let index = 0; index < spokeCount; index++) {
        const angle = (index / spokeCount) * Math.PI * 2 + .28;
        const inner = node.radius * .45;
        const outer = node.radius * 1.65;
        add(node, `M ${xy(node.x + Math.cos(angle) * inner, node.y + Math.sin(angle) * inner)} Q ${xy(node.x + Math.cos(angle + .08) * node.radius, node.y + Math.sin(angle + .08) * node.radius)} ${xy(node.x + Math.cos(angle) * outer, node.y + Math.sin(angle) * outer)}`);
      }
      continue;
    }
    if (node.type === 'tourism') {
      for (let index = -Math.ceil(level / 2); index <= Math.ceil(level / 2); index++) {
        add(node, `M ${xy(node.x - node.radius * .85, node.y + index * 9)} Q ${xy(node.x + node.radius * .16, node.y + index * 16 - 11)} ${xy(node.x + node.radius * 1.2, node.y + index * 24)}`);
      }
      continue;
    }
    const angle = (ORIENTATIONS[node.type] ?? 0) * Math.PI / 180;
    const u = { x: Math.cos(angle), y: Math.sin(angle) };
    const v = { x: -Math.sin(angle), y: Math.cos(angle) };
    const extent = node.radius * (node.type === 'industry' ? 1.3 : 1.48);
    for (const [axis, normal, count, length] of [[u, v, level + 2, extent], [v, u, level + 1, extent * .8]]) {
      for (let index = 0; index < count; index++) {
        const offset = (index - (count - 1) / 2) * node.radius * .44;
        const baseX = node.x + normal.x * offset;
        const baseY = node.y + normal.y * offset;
        const bend = node.type === 'industry' ? 2 : 9;
        const x1 = baseX - axis.x * length;
        const y1 = baseY - axis.y * length;
        const x2 = baseX + axis.x * length;
        const y2 = baseY + axis.y * length;
        const cx = baseX + normal.x * bend;
        const cy = baseY + normal.y * bend;
        add(node, `M ${xy(x1, y1)} Q ${xy(cx, cy)} ${xy(x2, y2)}`);
      }
    }
  }
  return lines;
}

export function getNodeAdvisories(node, nodes, wind = 'NW') {
  const advice = [];
  if (isWater(node.x, node.y)) advice.push({ kind: 'water', text: '圆心落入水体：请移到岸上，或把这里改为跨河连接点。' });
  if (node.x < 260 && node.y < 220) advice.push({ kind: 'slope', text: '接近山地边缘：优先顺等高线布置道路，避免密集陡坡街块。' });
  if (node.type === 'industry') {
    if (!isDownwind(node, nodes, wind)) advice.push({ kind: 'wind', text: '工业区不在当前设定风向的城市中心下风侧；调整风向或移动工业区。' });
    const resource = nodes.find((other) => other.type === 'resource');
    if (resource && Math.hypot(resource.x - node.x, resource.y - node.y) > 140) {
      advice.push({ kind: 'freight', text: '工业区离资源采集区较远：原料货运路径会变长，可调整其中一个节点。' });
    }
    const homes = nodes.filter((other) => other.type === 'residential');
    if (homes.some((home) => Math.hypot(home.x - node.x, home.y - node.y) < 150)) {
      advice.push({ kind: 'adjacency', text: '工业与居住中心过近：考虑保留绿带和货运绕行。' });
    }
  }
  if (node.type === 'resource') {
    const industry = nodes.find((other) => other.type === 'industry');
    if (industry && Math.hypot(industry.x - node.x, industry.y - node.y) > 140) {
      advice.push({ kind: 'freight', text: '资源采集区离工业区较远：原料运输会增加，优先寻找更近的可用资源点。' });
    }
  }
  if (node.type === 'seaHub' && distanceToShippingChannel(node) >= 85) {
    advice.push({ kind: 'shipping', text: '海运枢纽离示意航道较远；应靠近可通航水道并核实岸线条件。' });
  }
  if (advice.length === 0) advice.push({ kind: 'good', text: '当前位置可作为讨论起点；请按游戏里的实际资源与坡度图层再核实。' });
  return advice;
}
