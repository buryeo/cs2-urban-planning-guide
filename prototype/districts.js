const DISTRICT_BOUNDS = Object.freeze({ left: 80, right: 1010, top: 50, bottom: 650 });

function clipHalfPlane(polygon, nx, ny, threshold) {
  const result = [];
  for (let index = 0; index < polygon.length; index++) {
    const from = polygon[index];
    const to = polygon[(index + 1) % polygon.length];
    const fromSide = nx * from.x + ny * from.y - threshold;
    const toSide = nx * to.x + ny * to.y - threshold;
    const fromInside = fromSide <= 1e-7;
    const toInside = toSide <= 1e-7;
    if (fromInside !== toInside) {
      const fraction = fromSide / (fromSide - toSide);
      result.push({ x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction });
    }
    if (toInside) result.push(to);
  }
  return result;
}

export function makeDistricts(nodes) {
  return nodes.map((node) => {
    let polygon = [
      { x: DISTRICT_BOUNDS.left, y: DISTRICT_BOUNDS.top },
      { x: DISTRICT_BOUNDS.right, y: DISTRICT_BOUNDS.top },
      { x: DISTRICT_BOUNDS.right, y: DISTRICT_BOUNDS.bottom },
      { x: DISTRICT_BOUNDS.left, y: DISTRICT_BOUNDS.bottom },
    ];
    for (const other of nodes) {
      if (other.id === node.id) continue;
      const nx = 2 * (other.x - node.x);
      const ny = 2 * (other.y - node.y);
      const ownWeight = (node.radius * 1.25) ** 2;
      const otherWeight = (other.radius * 1.25) ** 2;
      const threshold = other.x ** 2 + other.y ** 2 - node.x ** 2 - node.y ** 2 + ownWeight - otherWeight;
      polygon = clipHalfPlane(polygon, nx, ny, threshold);
      if (polygon.length === 0) break;
    }
    return { id: node.id, type: node.type, points: polygon };
  });
}

export function makeDistrictSubareas(districts, nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return districts.flatMap((district) => {
    if (district.points.length < 3) return [];
    const node = byId.get(district.id);
    const center = district.points.reduce((sum, point) => ({ x: sum.x + point.x / district.points.length, y: sum.y + point.y / district.points.length }), { x: 0, y: 0 });
    const targets = [Math.floor(district.points.length / 3), Math.floor(district.points.length * 2 / 3)];
    const seeds = [
      { x: node.x, y: node.y },
      ...targets.map((index) => ({
        x: center.x * .42 + district.points[index].x * .58,
        y: center.y * .42 + district.points[index].y * .58,
      })),
    ];
    return seeds.map((seed, seedIndex) => {
      let points = district.points;
      for (const other of seeds) {
        if (other === seed) continue;
        points = clipHalfPlane(points, 2 * (other.x - seed.x), 2 * (other.y - seed.y),
          other.x ** 2 + other.y ** 2 - seed.x ** 2 - seed.y ** 2);
      }
      return { parentId: district.id, id: `${district.id}:${seedIndex}`, points };
    }).filter((area) => area.points.length >= 3);
  });
}

export function polygonContains(points, location) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = points[index];
    const b = points[previous];
    const onEdge = Math.abs((location.x - a.x) * (b.y - a.y) - (location.y - a.y) * (b.x - a.x)) < 1e-7
      && location.x >= Math.min(a.x, b.x) - 1e-7 && location.x <= Math.max(a.x, b.x) + 1e-7
      && location.y >= Math.min(a.y, b.y) - 1e-7 && location.y <= Math.max(a.y, b.y) + 1e-7;
    if (onEdge) return true;
    if ((a.y > location.y) !== (b.y > location.y)
      && location.x < ((b.x - a.x) * (location.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
