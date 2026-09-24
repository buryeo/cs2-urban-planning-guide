export const NODE_SHAPES = Object.freeze([
  { id: 'circle', name: '圆形', scaleX: 1, scaleY: 1 },
  { id: 'wide', name: '横向椭圆', scaleX: 1.5, scaleY: .72 },
  { id: 'tall', name: '纵向椭圆', scaleX: .72, scaleY: 1.5 },
]);

export function getNodeShape(shape) {
  return NODE_SHAPES.find((item) => item.id === shape) ?? NODE_SHAPES[0];
}

export function nodeAngle(node) {
  return Number.isFinite(node.angle) ? node.angle : 0;
}

export function rotateOffset(node, x, y) {
  const angle = nodeAngle(node) * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

export function shapeDistance(node, dx, dy) {
  const angle = nodeAngle(node) * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const shape = getNodeShape(node.shape);
  return Math.hypot((dx * cos + dy * sin) / shape.scaleX,
    (-dx * sin + dy * cos) / shape.scaleY);
}
