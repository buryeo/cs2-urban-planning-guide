// Route only on continuous, moderately sloped land. A missing route means the
// prototype cannot justify a road here; it is not permission to invent a bridge.
const preparedCache = new WeakMap();
const STEPS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

class Heap {
  constructor() { this.items = []; }
  push(value) {
    const items = this.items;
    let i = items.length;
    items.push(value);
    while (i) {
      const p = (i - 1) >> 1;
      if (items[p].score <= value.score) break;
      items[i] = items[p]; i = p;
    }
    items[i] = value;
  }
  pop() {
    const items = this.items;
    const first = items[0];
    const last = items.pop();
    if (items.length) {
      let i = 0;
      while (i * 2 + 1 < items.length) {
        let child = i * 2 + 1;
        if (child + 1 < items.length && items[child + 1].score < items[child].score) child++;
        if (last.score <= items[child].score) break;
        items[i] = items[child]; i = child;
      }
      items[i] = last;
    }
    return first;
  }
  get length() { return this.items.length; }
}

function prepare(terrain, metersPerCell, maxGrade) {
  const previous = preparedCache.get(terrain);
  if (previous?.metersPerCell === metersPerCell && previous.maxGrade === maxGrade) return previous;
  const { width, height, land, elevation } = terrain;
  const passable = new Uint8Array(width * height);
  const grades = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (!land[i]) continue;
    let rise = 0;
    for (const j of [x > 0 ? i - 1 : -1, x + 1 < width ? i + 1 : -1, y > 0 ? i - width : -1, y + 1 < height ? i + width : -1]) {
      if (j >= 0 && land[j]) rise = Math.max(rise, Math.abs(elevation[i] - elevation[j]));
    }
    grades[i] = rise / metersPerCell;
    passable[i] = grades[i] <= maxGrade ? 1 : 0;
  }
  const result = { metersPerCell, maxGrade, passable, grades };
  preparedCache.set(terrain, result);
  return result;
}

function nearestPassable(point, terrain, passable, originX, originY, mapSize, maxSnap) {
  const { width, height } = terrain;
  const x = Math.floor((point.x - originX) / mapSize * width);
  const y = Math.floor((point.y - originY) / mapSize * height);
  const span = Math.ceil(maxSnap * width / mapSize);
  let best = -1;
  let bestDistance = Infinity;
  for (let dy = -span; dy <= span; dy++) for (let dx = -span; dx <= span; dx++) {
    const nx = x + dx; const ny = y + dy;
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
    const i = ny * width + nx;
    if (!passable[i]) continue;
    const distance = Math.hypot(originX + nx * mapSize / width - point.x,
      originY + ny * mapSize / height - point.y);
    if (distance < bestDistance && distance <= maxSnap) { bestDistance = distance; best = i; }
  }
  return best;
}

export function routeOnTerrain(terrain, start, end, options = {}) {
  const { width, height } = terrain;
  const originX = options.originX ?? 200;
  const originY = options.originY ?? 0;
  const mapSize = options.mapSize ?? 700;
  const metersPerCell = options.metersPerCell ?? 443;
  const maxGrade = options.maxGrade ?? .18;
  const maxSnap = options.maxSnap ?? 20;
  const maxDetour = options.maxDetour ?? 1.8;
  const gradeWeight = options.gradeWeight ?? 8;
  const { passable, grades } = prepare(terrain, metersPerCell, maxGrade);
  const source = nearestPassable(start, terrain, passable, originX, originY, mapSize, maxSnap);
  const target = nearestPassable(end, terrain, passable, originX, originY, mapSize, maxSnap);
  if (source < 0 || target < 0) return null;
  const costs = new Float64Array(width * height).fill(Infinity);
  const previous = new Int32Array(width * height).fill(-1);
  const heap = new Heap();
  const targetX = target % width; const targetY = Math.floor(target / width);
  costs[source] = 0;
  heap.push({ index: source, cost: 0, score: Math.hypot(source % width - targetX, Math.floor(source / width) - targetY) });
  while (heap.length) {
    const current = heap.pop();
    if (current.cost > costs[current.index] + 1e-7) continue;
    if (current.index === target) break;
    const x = current.index % width; const y = Math.floor(current.index / width);
    for (const [dx, dy] of STEPS) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const next = ny * width + nx;
      if (!passable[next]) continue;
      if (dx && dy && (!passable[y * width + nx] || !passable[ny * width + x])) continue;
      const cost = current.cost + Math.hypot(dx, dy) * (1 + gradeWeight * Math.max(grades[current.index], grades[next]));
      if (cost >= costs[next] - 1e-7) continue;
      costs[next] = cost; previous[next] = current.index;
      heap.push({ index: next, cost, score: cost + Math.hypot(nx - targetX, ny - targetY) });
    }
  }
  if (!Number.isFinite(costs[target])) return null;
  const cells = [];
  for (let index = target; index >= 0; index = previous[index]) {
    cells.push(index);
    if (index === source) break;
  }
  cells.reverse();
  let length = 0;
  for (let i = 1; i < cells.length; i++) length += Math.hypot(cells[i] % width - cells[i - 1] % width,
    Math.floor(cells[i] / width) - Math.floor(cells[i - 1] / width));
  const direct = Math.hypot((end.x - start.x) * width / mapSize, (end.y - start.y) * height / mapSize);
  if (direct > 0 && length > direct * maxDetour) return null;
  const points = cells.map((index) => ({
    x: originX + (index % width) * mapSize / width,
    y: originY + Math.floor(index / width) * mapSize / height,
  }));
  points[0] = { x: start.x, y: start.y };
  points[points.length - 1] = { x: end.x, y: end.y };
  return points;
}

export function routeViaPoint(terrain, start, via, end, options = {}) {
  const col = Math.floor((via.x - (options.originX ?? 200)) / (options.mapSize ?? 700) * terrain.width);
  const row = Math.floor((via.y - (options.originY ?? 0)) / (options.mapSize ?? 700) * terrain.height);
  const { passable } = prepare(terrain, options.metersPerCell ?? 443, options.maxGrade ?? .18);
  if (col < 0 || row < 0 || col >= terrain.width || row >= terrain.height || !passable[row * terrain.width + col]) return null;
  const snap = Math.min(options.maxSnap ?? 20, (options.mapSize ?? 700) / terrain.width * 1.5);
  const first = routeOnTerrain(terrain, start, via, { ...options, maxSnap: snap });
  const second = routeOnTerrain(terrain, via, end, { ...options, maxSnap: snap });
  return first && second ? [...first, ...second.slice(1)] : null;
}

function segmentIsPassable(terrain, a, b, passable, options) {
  const originX = options.originX ?? 200;
  const originY = options.originY ?? 0;
  const mapSize = options.mapSize ?? 700;
  const step = mapSize / Math.max(terrain.width, terrain.height) / 2;
  const samples = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
  for (let k = 0; k <= samples; k++) {
    const x = a.x + (b.x - a.x) * k / samples;
    const y = a.y + (b.y - a.y) * k / samples;
    const col = Math.floor((x - originX) / mapSize * terrain.width);
    const row = Math.floor((y - originY) / mapSize * terrain.height);
    if (col < 0 || row < 0 || col >= terrain.width || row >= terrain.height || !passable[row * terrain.width + col]) return false;
  }
  return true;
}

export function softenTerrainRoute(terrain, points, options = {}) {
  if (!terrain || points.length < 3) return points;
  const { passable } = prepare(terrain, options.metersPerCell ?? 443, options.maxGrade ?? .18);
  const simplified = [points[0]];
  for (let i = 0; i < points.length - 1;) {
    let next = i + 1;
    for (let j = Math.min(points.length - 1, i + 24); j > i + 1; j--) {
      if (segmentIsPassable(terrain, points[i], points[j], passable, options)) { next = j; break; }
    }
    simplified.push(points[next]);
    i = next;
  }
  let result = simplified;
  for (let iteration = 0; iteration < 2; iteration++) {
    const next = [result[0]];
    for (let i = 1; i < result.length - 1; i++) {
      const before = result[i - 1]; const current = result[i]; const after = result[i + 1];
      const entering = { x: (before.x + 3 * current.x) / 4, y: (before.y + 3 * current.y) / 4 };
      const leaving = { x: (3 * current.x + after.x) / 4, y: (3 * current.y + after.y) / 4 };
      if (segmentIsPassable(terrain, next.at(-1), entering, passable, options)
        && segmentIsPassable(terrain, entering, leaving, passable, options)
        && segmentIsPassable(terrain, leaving, after, passable, options)) next.push(entering, leaving);
      else next.push(current);
    }
    next.push(result.at(-1));
    result = next;
  }
  return result;
}

export function designTerrainRoute(terrain, corridor, nodes, edit = {}, options = {}) {
  const from = nodes.find((node) => node.id === corridor.from);
  const to = nodes.find((node) => node.id === corridor.to);
  if (!from || !to) return { ...corridor, warning: '连接端点已不存在。' };
  const mode = edit.mode ?? 'balanced';
  const gradeWeight = { short: 0, balanced: 8, gentle: 32 }[mode] ?? 8;
  const routeOptions = { ...options, gradeWeight };
  const route = edit.via
    ? routeViaPoint(terrain, from, edit.via, to, routeOptions)
    : edit.mode ? routeOnTerrain(terrain, from, to, routeOptions) : corridor.points;
  if (!route) return { ...corridor, warning: '此必经点无法沿连续缓坡陆地接通；仍显示原候选。' };
  if (edit.via) {
    const split = route.findIndex((point) => point.x === edit.via.x && point.y === edit.via.y);
    if (split > 0 && split < route.length - 1) {
      return { ...corridor, points: [
        ...softenTerrainRoute(terrain, route.slice(0, split + 1), options),
        ...softenTerrainRoute(terrain, route.slice(split), options).slice(1),
      ], warning: null };
    }
  }
  return { ...corridor, points: softenTerrainRoute(terrain, route, options), warning: null };
}

export function findTightTurns(points, minRadius = 10) {
  if (points.length < 3) return [];
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative.at(-1) + Math.hypot(
    points[i].x - points[i - 1].x, points[i].y - points[i - 1].y,
  ));
  const total = cumulative.at(-1);
  const spacing = 8;
  const at = (distance) => {
    let i = 1;
    while (i < cumulative.length - 1 && cumulative[i] < distance) i++;
    const length = cumulative[i] - cumulative[i - 1] || 1;
    const t = (distance - cumulative[i - 1]) / length;
    return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
      y: points[i - 1].y + (points[i].y - points[i - 1].y) * t };
  };
  const candidates = [];
  for (let s = spacing; s < total - spacing; s += spacing / 2) {
    const a = at(s - spacing); const b = at(s); const c = at(s + spacing);
    const cross = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    if (cross < 1e-5) continue;
    const ab = Math.hypot(b.x - a.x, b.y - a.y);
    const bc = Math.hypot(c.x - b.x, c.y - b.y);
    const ac = Math.hypot(c.x - a.x, c.y - a.y);
    const radius = ab * bc * ac / (2 * cross);
    if (radius < minRadius) candidates.push({ ...b, radius, distance: s });
  }
  const selected = [];
  for (const point of candidates.sort((a, b) => a.radius - b.radius)) {
    if (selected.every((other) => Math.abs(other.distance - point.distance) > spacing * 2)) selected.push(point);
    if (selected.length === 5) break;
  }
  return selected.sort((a, b) => a.distance - b.distance);
}
