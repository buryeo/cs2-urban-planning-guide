export function clampWindPosition(position, terrainMode) {
  const left = terrainMode ? 230 : 30;
  const right = terrainMode ? 870 : 1070;
  return {
    x: Math.max(left, Math.min(right, position.x)),
    y: Math.max(30, Math.min(670, position.y)),
  };
}
