export function riverX(y) {
  return 540 + 0.16 * y + 29 * Math.sin(y / 72) + 10 * Math.sin(y / 25);
}

export function northBranchY(x) {
  return 455 + 0.34 * (x - 612);
}

function band(from, to, step, center, halfWidth, vertical = false) {
  const near = [];
  const far = [];
  for (let value = from; value <= to; value += step) {
    const mid = center(value);
    const width = halfWidth(value);
    if (vertical) {
      near.push({ x: mid - width, y: value });
      far.push({ x: mid + width, y: value });
    } else {
      near.push({ x: value, y: mid - width });
      far.push({ x: value, y: mid + width });
    }
  }
  return [...near, ...far.reverse()];
}

function pond(cx, cy, rx, ry, count = 44) {
  return Array.from({ length: count }, (_, index) => {
    const angle = index * 2 * Math.PI / count;
    const roughness = 1 + .11 * Math.sin(angle * 5 + .3) + .065 * Math.sin(angle * 9 + 1.4);
    return { x: cx + Math.cos(angle) * rx * roughness, y: cy + Math.sin(angle) * ry * roughness };
  });
}

const polygons = [
  band(-20, 740, 10, riverX, (y) => 30 + 5 * Math.sin(y / 38) + 2 * Math.sin(y / 12), true),
  band(605, 1105, 9, northBranchY, (x) => 20 + 5 * Math.sin(x / 43) + 2 * Math.sin(x / 17)),
  band(660, 1105, 9, (x) => 620 + .25 * (x - 680) + 5 * Math.sin(x / 45), (x) => 15 + 3 * Math.sin(x / 31)),
  [
    ...Array.from({ length: 75 }, (_, index) => {
      const y = -20 + index * 10;
      return { x: 1017 + 10 * Math.sin(y / 47) + 5 * Math.sin(y / 14), y };
    }),
    { x: 1120, y: 720 }, { x: 1120, y: -20 },
  ],
  pond(425, 165, 47, 32),
  pond(795, 82, 22, 16),
  band(0, 550, 10, (x) => 133 + .19 * x + 11 * Math.sin(x / 55), (x) => 5 + 1.8 * Math.sin(x / 29)),
  band(-10, 515, 10, (x) => 635 - .09 * x + 9 * Math.sin(x / 49), (x) => 4.5 + 1.5 * Math.sin(x / 21)),
];

export function makeWaterPolygons() {
  return polygons;
}

export function polygonPath(points) {
  return `${points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')} Z`;
}

function contains(points, x, y) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = points[index];
    const b = points[previous];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function waterAt(x, y) {
  return polygons.some((polygon) => contains(polygon, x, y));
}
