export function readPngHeader(bytes) {
  if (bytes.length < 29 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return null;
  if (![0, 0, 0, 13, 73, 72, 68, 82].every((value, index) => bytes[index + 8] === value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20), bitDepth: bytes[24], colorType: bytes[25] };
}

export function validateHeightmap({ name, width, height, bitDepth, colorType }) {
  if (!/\.png$/i.test(name)) return '请选择地图编辑器导出的 PNG 高程图。';
  if (width !== 4096 || height !== 4096) return '高程图需要是 4096×4096 像素；截图不能代替高程数据。';
  if (bitDepth !== 16 || colorType !== 0) return '高程图需要是 16 位灰度 PNG，普通彩色截图不能代替。';
  return null;
}

export function validateTerrainPreview({ name, width, height, bitDepth, colorType }) {
  if (!/\.png$/i.test(name)) return '请选择 PNG 高程图。';
  if (bitDepth !== 16 || colorType !== 0) return '高程图需要是 16 位灰度 PNG，普通彩色截图不能代替。';
  if (width < 1024 || height < 1024) return '预览高程图的宽和高均需至少 1024 像素。';
  return null;
}

export function fitHeightmap(width, height, viewportWidth, viewportHeight) {
  const scale = Math.min(viewportWidth / width, viewportHeight / height);
  const fittedWidth = Math.round(width * scale);
  const fittedHeight = Math.round(height * scale);
  return {
    x: Math.round((viewportWidth - fittedWidth) / 2),
    y: Math.round((viewportHeight - fittedHeight) / 2),
    width: fittedWidth,
    height: fittedHeight,
  };
}
