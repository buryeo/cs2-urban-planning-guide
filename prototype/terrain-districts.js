// Grow planning areas over buildable terrain. Water, steep cells and distant land
// remain unassigned; Euclidean Voronoi polygons cannot express these gaps.
import { shapeDistance } from './node-shapes.js';
class MinHeap {
  constructor() { this.items = []; }
  push(item) {
    const a = this.items;
    let i = a.length;
    a.push(item);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].cost <= item.cost) break;
      a[i] = a[p]; i = p;
    }
    a[i] = item;
  }
  pop() {
    const a = this.items;
    const first = a[0];
    const last = a.pop();
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let child = i * 2 + 1;
        if (child + 1 < a.length && a[child + 1].cost < a[child].cost) child++;
        if (last.cost <= a[child].cost) break;
        a[i] = a[child]; i = child;
      }
      a[i] = last;
    }
    return first;
  }
  get length() { return this.items.length; }
}

export function makeTerrainDistricts(terrain, nodes, options = {}) {
  const { width, height, land, elevation } = terrain;
  const originX = options.originX ?? 200;
  const originY = options.originY ?? 0;
  const mapSize = options.mapSize ?? 700;
  const metersPerCell = options.metersPerCell ?? 485;
  const maxGrade = options.maxGrade ?? .18;
  const size = width * height;
  const owners = new Int16Array(size).fill(-1);
  const costs = new Float32Array(size).fill(Infinity);
  const passable = new Uint8Array(size);
  const grades = new Float32Array(size);
  const heap = new MinHeap();
  const nodeIds = nodes.map((node) => node.id);
  const stepSize = mapSize / width;
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  const stepCosts = nodes.map((node) => {
    const radius = Math.max(16, node.radius * 2.2);
    return directions.map(([dx, dy]) => shapeDistance(node, dx, dy) * stepSize / radius);
  });

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

  nodes.forEach((node, owner) => {
    const x = Math.floor((node.x - originX) / mapSize * width);
    const y = Math.floor((node.y - originY) / mapSize * height);
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const i = y * width + x;
    if (!land[i] || !passable[i]) return;
    if (costs[i] === 0) return;
    costs[i] = 0; owners[i] = owner;
    heap.push({ index: i, owner, cost: 0 });
  });

  while (heap.length) {
    const current = heap.pop();
    if (current.cost > costs[current.index] + 1e-6 || current.owner !== owners[current.index]) continue;
    const x = current.index % width;
    const y = Math.floor(current.index / width);
    const node = nodes[current.owner];
    const radius = Math.max(16, node.radius * 2.2);
    for (let direction = 0; direction < directions.length; direction++) {
      const [dx, dy] = directions[direction];
      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
      const next = nextY * width + nextX;
      if (!passable[next]) continue;
      if (dx && dy && (!passable[y * width + nextX] || !passable[nextY * width + x])) continue;
      const fromCenterX = (nextX + .5) * stepSize + originX - node.x;
      const fromCenterY = (nextY + .5) * stepSize + originY - node.y;
      if (shapeDistance(node, fromCenterX, fromCenterY) > radius) continue;
      const cost = current.cost + stepCosts[current.owner][direction] * (1 + 4 * Math.max(grades[current.index], grades[next]));
      if (cost > 1 || cost >= costs[next] - 1e-6) continue;
      costs[next] = cost; owners[next] = current.owner;
      heap.push({ index: next, owner: current.owner, cost });
    }
  }
  return { width, height, originX, originY, mapSize, owners, nodeIds };
}

export function terrainDistrictAt(districts, x, y) {
  if (!districts) return null;
  const px = Math.floor((x - districts.originX) / districts.mapSize * districts.width);
  const py = Math.floor((y - districts.originY) / districts.mapSize * districts.height);
  if (px < 0 || px >= districts.width || py < 0 || py >= districts.height) return null;
  const owner = districts.owners[py * districts.width + px];
  return owner < 0 ? null : districts.nodeIds[owner];
}
