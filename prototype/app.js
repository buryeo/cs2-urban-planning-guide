import {
  MAP_BOUNDS, NODE_TYPES, getNodeType, makeDefaultNodes, moveNode, resizeNode,
  northBranchY, isWater, WIND_DIRECTIONS, recommendIndustryPosition, recommendResourcePosition,
  generateCorridors, makeStreetSegments, getNodeAdvisories, isDownwind,
} from './planner.js';
import { makeDistricts, makeDistrictSubareas, polygonContains } from './districts.js';
import { makeWaterPolygons, polygonPath } from './terrain.js';
import { fitHeightmap, readPngHeader, validateHeightmap, validateTerrainPreview } from './heightmap.js';
import { TERRAIN_RECT, isWaterColor, nearestLandPoint, placeTerrainNodes, terrainConnections } from './terrain-plan.js?v=6';
import { designTerrainRoute, findTightTurns } from './terrain-routes.js?v=5';
import { makeTerrainDistricts, terrainDistrictAt } from './terrain-districts.js';
import { clampWindPosition } from './wind-marker.js';
import { NODE_SHAPES, getNodeShape, nodeAngle, rotateOffset, shapeDistance } from './node-shapes.js';

const storageKey = 'cs2-river-delta-prototype-v4';
const stageCopy = [
  {
    title: '读懂场地',
    intro: '先看河道、缓坡、等高线、入口与可航行水道，再设定主导风向。',
    learning: '等高线引导坡地走线；工业区宜先放在城市中心下风侧，海运枢纽需靠近可通航水道。风向可调整，等高线是示意假设。',
    hint: '先看细化水系与等高线，蓝色虚线是示意航道；风向可在右侧调整。',
  },
  {
    title: '摆放城区节点',
    intro: '先用大圈确定城市活动中心。初始方案有四个居住中心，资源区靠近工业区。',
    learning: '缩短资源到工业的货运距离，有助于减少原料运输绕行；四个居住中心分布在两岸，后续要检查它们与工作和公园的联系。',
    hint: '拖动节点调整位置；可在右侧更换形状，拖动右下角的小点调整影响范围。',
  },
  {
    title: '生成片区',
    intro: '节点已转为连续的片区边界。白色陆地上的虚线是建议边界，水体自然把片区分开。',
    learning: '片区是讨论道路、公共服务和开发顺序的中间尺度，不是行政区，也不是单一用途的分区。调整中心或影响范围时，边界会重新分配。',
    hint: '点击片区选择，拖动中心标记，或在右侧调整形状与影响范围；返回上一步可增删节点。',
  },
  {
    title: '安排主通道',
    intro: '橙色线表示优先规划的重要出行走廊。跨河段集中在候选桥位，可以锁定喜欢的连接再重算。',
    learning: '主通道不等于所有道路都要加宽。跨河点少时，应留意绕行；中心间的短联系也可以优先考虑步行与公交。',
    hint: '选择走廊，比较较短与缓坡候选；添加必经点后拖动蓝色圆点调整线位。',
  },
  {
    title: '预览街区道路',
    intro: '局部街道采用不同方向与密度：平地较规整，中心略微转向，公园和岸边更柔和。',
    learning: '多样性来自场地与功能，不是随机弯曲。街块过大可能增加步行绕行；过密则会挤占公园和坡地。',
    hint: '调整街道密度，再返回前一步移动节点，观察局部路网如何重新展开。',
  },
];

const $ = (id) => document.getElementById(id);
const map = $('map');
const saved = readSaved();
let state = saved ?? freshState();
let dragging = null;
let focusMode = false;
let inspectorHidden = false;
let heightmapUrl = null;
let heightmapName = '';
let heightmapMetadata = null;
let heightmapVisible = false;
let colorPreviewAvailable = false;
let heightmapColorVisible = false;
let heightmapLoadToken = 0;
let terrainLandRaster = null;
let terrainPlanningGrid = null;
let lastTerrainDistrictResult = null;
let lastTerrainDistrictKey = '';
let planningOverlayVisible = true;

function terrainPlanningActive() {
  return heightmapVisible && heightmapName === 'san-francisco-bay-heightmap.png' && !!terrainLandRaster;
}

function terrainIsLand(x, y) {
  if (!terrainLandRaster || x < TERRAIN_RECT.left || x > TERRAIN_RECT.right || y < 0 || y > 700) return false;
  const px = Math.min(terrainLandRaster.width - 1, Math.floor((x - TERRAIN_RECT.left) / 700 * terrainLandRaster.width));
  const py = Math.min(terrainLandRaster.height - 1, Math.floor(y / 700 * terrainLandRaster.height));
  return terrainLandRaster.data[(py * terrainLandRaster.width + px) * 4 + 3] > 0;
}

async function makeTerrainLandRaster(source) {
  const image = new Image();
  image.src = source;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 700;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, 700, 700);
  const pixels = context.getImageData(0, 0, 700, 700);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const water = isWaterColor(pixels.data[index], pixels.data[index + 1], pixels.data[index + 2]);
    pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = 255;
    pixels.data[index + 3] = water ? 0 : 255;
  }
  context.putImageData(pixels, 0, 0);
  $('terrainLandMaskImage').setAttribute('href', canvas.toDataURL('image/png'));
  return { width: 700, height: 700, data: pixels.data };
}

function makeTerrainPlanningGrid(image, landRaster) {
  if (!landRaster) return null;
  const width = 280;
  const height = 280;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const source = context.getImageData(0, 0, width, height).data;
  const land = new Uint8Array(width * height);
  const elevation = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    const lx = Math.min(699, Math.floor((x + .5) / width * 700));
    const ly = Math.min(699, Math.floor((y + .5) / height * 700));
    land[index] = landRaster.data[(ly * 700 + lx) * 4 + 3] > 0 ? 1 : 0;
    // Browsers display this 16-bit PNG as 8-bit gray. The source encoding is
    // (meters + 300) * 40; 257 restores the decoded gray byte's scale.
    elevation[index] = (source[index * 4] * 257) / 40 - 300;
  }
  return { width, height, land, elevation };
}

function updateHeightmapView() {
  const isSanFrancisco = /^san-francisco-bay-heightmap\.png$/i.test(heightmapName);
  const terrainPlanning = terrainPlanningActive() && planningOverlayVisible;
  map.classList.toggle('heightmap-view', heightmapVisible);
  map.classList.toggle('terrain-planning', terrainPlanning);
  map.closest('.map-card').classList.toggle('heightmap-active', heightmapVisible);
  $('heightmapToggle').hidden = !heightmapUrl;
  $('heightmapToggle').textContent = terrainPlanningActive() ? (planningOverlayVisible ? '仅看地形' : '显示规划图层') : heightmapVisible ? '返回规划图' : '查看高程图';
  $('heightmapToggle').setAttribute('aria-pressed', String(terrainPlanningActive() ? planningOverlayVisible : heightmapVisible));
  $('heightmapImportLabel').textContent = heightmapUrl ? '更换高程图' : '导入高程图';
  const bounds = heightmapMetadata ? fitHeightmap(heightmapMetadata.width, heightmapMetadata.height, 1100, 700) : null;
  map.setAttribute('viewBox', heightmapVisible && bounds ? `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}` : '0 0 1100 700');
  map.style.aspectRatio = heightmapVisible && bounds ? `${bounds.width}/${bounds.height}` : '';
  const isPurerefu = /^purerefu_v2_high-res-heightmap\.png$/i.test(heightmapName);
  const nativeExport = heightmapMetadata && !validateHeightmap({ name: heightmapName, ...heightmapMetadata });
  const colored = heightmapColorVisible && isSanFrancisco && colorPreviewAvailable;
  const imageUrl = colored ? './local-samples/san-francisco-bay-terrain-preview.png' : heightmapUrl;
  $('terrainColorToggle').hidden = !heightmapVisible || !isSanFrancisco || !colorPreviewAvailable;
  $('terrainColorToggle').textContent = colored ? '查看原始灰度' : '查看设色地形';
  $('terrainColorToggle').setAttribute('aria-pressed', String(colored));
  $('heightmapLayer').innerHTML = heightmapUrl
    ? `<rect width="1100" height="700" fill="#f4f7f3"/><image href="${imageUrl}" x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}"/><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="none" stroke="#607d76" stroke-width="2"/><text x="${bounds.x + 16}" y="${bounds.y + 29}" class="heightmap-label">${isPurerefu ? 'Purerefu · 玩家原创地图' : isSanFrancisco ? '旧金山湾 · 真实高程数据' : '外部高程图'} · ${colored ? '地形设色预览' : '原始灰度预览'}</text>`
    : '';
  $('mapHeading').innerHTML = heightmapVisible ? (isPurerefu ? 'Purerefu <span>玩家地图样例</span>' : isSanFrancisco ? '旧金山湾 <span>真实地形样例</span>' : '高程图 <span>外部数据预览</span>') : 'River Delta <span>河流三角洲</span>';
  $('mapMeta').innerHTML = terrainPlanningActive() ? '真实高程与水陆轮廓<br><small>规划图层为候选草案</small>' : '代表性地形示意<br><small>非游戏实测高度图</small>';
  document.title = heightmapVisible && isSanFrancisco ? '旧金山湾 · 城区规划向导原型' : 'River Delta · 城区规划向导原型';
  $('introCopy').textContent = terrainPlanningActive()
    ? '在旧金山湾真实地形上直接摆放节点，再逐步生成片区与候选连接。地形来自高程数据，道路与航道仍需校核。'
    : '从一张空白的 River Delta 示意图开始，先决定城市里的“点”，再看道路怎样把它们连起来。';
  map.setAttribute('aria-label', terrainPlanningActive() ? '旧金山湾真实地形与可编辑城区规划图' : '河流三角洲地形与可编辑城区规划图');
  document.querySelector('.page-footer span').textContent = terrainPlanningActive() ? 'URBAN PLANNING GUIDE · SAN FRANCISCO BAY STUDY' : 'URBAN PLANNING GUIDE · RIVER DELTA STUDY';
  $('heightmapAttribution').hidden = !heightmapVisible || !(isPurerefu || isSanFrancisco);
  $('heightmapAttribution').href = isSanFrancisco ? 'https://registry.opendata.aws/terrain-tiles/' : 'https://steamcommunity.com/sharedfiles/filedetails/?id=3467192129';
  $('heightmapAttribution').textContent = isSanFrancisco ? '数据来源：Mapzen / USGS / NOAA' : 'Purerefu 作者 treezen · 来源';
  $('terrainColorPreview').hidden = !heightmapVisible || !isSanFrancisco || !colorPreviewAvailable;
  for (const layer of [$('subdistrictLayer'), $('districtLayer'), $('streetLayer')]) layer.setAttribute('mask', terrainPlanningActive() ? 'url(#terrainLandMask)' : 'url(#landMask)');
  if (heightmapVisible) {
    const terrainHints = [
      '查看旧金山湾地形与水陆轮廓；风向是可调整的规划假设。',
      '拖动节点放置中心；可在右侧更换形状，节点会贴附到地形图上的陆地。',
      '片区沿可开发陆地和节点形状扩展；水域、陡坡和远离中心的山地留白。',
      '切换较短或缓坡候选，拖动蓝色必经点；橙点标出局部急弯。',
      '街区道路只作几何预览，实际走线须结合坡度与既有路网。',
    ];
    $('mapHint').textContent = terrainPlanningActive() ? (planningOverlayVisible ? terrainHints[state.stage] : '当前只显示地形；点击“显示规划图层”继续编辑。') : '高程图预览；这份外部地图尚未生成规划图层。';
    $('heightmapStatus').textContent = `${heightmapName} · ${heightmapMetadata.width}×${heightmapMetadata.height} · 16 位灰度源图 · ${terrainPlanningActive() ? '地形上可直接编辑节点；走廊为候选几何' : nativeExport ? '像素尺寸符合 CS2 高程图格式' : '外部样例，仅供预览'} · 本地文件`;
  } else if (heightmapUrl) {
    $('heightmapStatus').textContent = '当前显示概念规划图 · 可切换查看已导入高程图';
  } else {
    $('heightmapStatus').textContent = '地图为概念比例 · 不用于工程测量';
  }
}

function nodeShortLabel(node) {
  if (node.type === 'residential') {
    const number = node.id === 'residential' ? '①' : ({ 'residential-2': '②', 'residential-3': '③', 'residential-4': '④' }[node.id] ?? '');
    return `居住${number}`;
  }
  const type = getNodeType(node.type);
  return `${type.short}${node.id === 'park-2' ? ' ②' : node.id === 'park-1' ? ' ①' : ''}`;
}

function reflowSupplyNodes(nodes, wind) {
  const industry = nodes.find((node) => node.type === 'industry');
  if (!industry) return nodes;
  const industrySite = industry.locked ? industry : recommendIndustryPosition(nodes, wind);
  const withIndustry = nodes.map((node) => node === industry && !node.locked ? { ...node, ...industrySite } : node);
  const resourceSite = recommendResourcePosition(withIndustry, industrySite);
  return withIndustry.map((node) => node.type === 'resource' && !node.locked ? { ...node, ...resourceSite } : node);
}

function renderCanvasMode() {
  $('workspace').classList.toggle('map-focus', focusMode);
  $('workspace').classList.toggle('panel-hidden', inspectorHidden && focusMode);
  document.body.classList.toggle('map-focus-active', focusMode);
  $('canvasSizeButton').textContent = focusMode ? '退出大画布' : '⤢ 大画布';
  $('canvasSizeButton').setAttribute('aria-pressed', String(focusMode));
  $('inspectorToggle').hidden = !focusMode;
  $('inspectorToggle').textContent = inspectorHidden ? '显示编辑面板' : '隐藏编辑面板';
  $('inspectorToggle').setAttribute('aria-pressed', String(inspectorHidden));
}

function freshState() {
  const nodes = makeDefaultNodes();
  return {
    stage: 0, mapId: 'river-delta', nodes, selectedNodeId: 'cbd', selectedCorridorId: 'landHub-cbd', wind: 'NW',
    corridors: generateCorridors(nodes), lockedCorridors: [], routeEdits: {},
    variant: 0, density: 2, boundaryScale: 100, addType: 'park', windPosition: null,
  };
}

function readSaved() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey));
    if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.corridors)) return null;
    if (!value.nodes.every((node) => getNodeType(node.type) && Number.isFinite(node.x) && Number.isFinite(node.y))) return null;
    return {
      ...freshState(), ...value, stage: Math.min(4, Math.max(0, value.stage ?? 1)),
      routeEdits: value.routeEdits && typeof value.routeEdits === 'object' ? value.routeEdits : {},
      windPosition: Number.isFinite(value.windPosition?.x) && Number.isFinite(value.windPosition?.y) ? value.windPosition : null,
    };
  } catch {
    return null;
  }
}

function persist() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function svgPoint(event) {
  const point = map.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const transformed = point.matrixTransform(map.getScreenCTM().inverse());
  return { x: transformed.x, y: transformed.y };
}

function drawTerrain() {
  const shapes = makeWaterPolygons().map((polygon) => polygonPath(polygon));
  $('waterGeometry').innerHTML = shapes.map((path, index) => `<path d="${path}" class="water-shape water-${index}"/>`).join('');
  $('maskWaterLayer').innerHTML = shapes.map((path) => `<path d="${path}"/>`).join('');
}

function drawNeighborhoodTexture(districts) {
  if (terrainPlanningActive()) { $('baseParcelLayer').innerHTML = ''; return; }
  if (state.stage !== 4) { $('baseParcelLayer').innerHTML = ''; return; }
  const pieces = [];
  for (let y = 77; y < 638; y += 13) {
    for (let x = 91; x < 1000; x += 15) {
      const candidate = districts.find((district) => polygonContains(district.points, { x, y }));
      if (!candidate || ['resource', 'park', 'seaHub', 'airHub'].includes(candidate.type)) continue;
      if (isWater(x, y) || (x < 300 && y < 235)) continue;
      const node = state.nodes.find((item) => item.id === candidate.id);
      if (!node || Math.hypot(x - node.x, y - node.y) > Math.max(95, node.radius * 2.1)) continue;
      const tint = (Math.floor(x / 15) * 7 + Math.floor(y / 13) * 11) % 5;
      if (tint === 0 && (x + y) % 3 === 0) continue;
      pieces.push(`<rect class="planned-block tint-${tint}" x="${x}" y="${y}" width="${10 + tint % 3}" height="${8 + tint % 2}" rx=".5"/>`);
    }
  }
  $('baseParcelLayer').innerHTML = pieces.join('');
}

function drawDistricts(districts) {
  if (terrainPlanningActive() && terrainPlanningGrid) {
    $('subdistrictLayer').innerHTML = '';
    if (state.stage < 2) { $('districtLayer').innerHTML = ''; $('districtLabelLayer').innerHTML = ''; return; }
    const key = JSON.stringify(state.nodes.map(({ id, x, y, radius, shape, angle }) => [id, x, y, radius, shape, angle]));
    if (key !== lastTerrainDistrictKey || !lastTerrainDistrictResult) {
      lastTerrainDistrictResult = makeTerrainDistricts(terrainPlanningGrid, state.nodes, {
        originX: TERRAIN_RECT.left, mapSize: 700, metersPerCell: 443, maxGrade: .18,
      });
      lastTerrainDistrictKey = key;
    }
    const result = lastTerrainDistrictResult;
    const canvas = document.createElement('canvas');
    canvas.width = result.width; canvas.height = result.height;
    const context = canvas.getContext('2d');
    const image = context.createImageData(result.width, result.height);
    const colors = state.nodes.map((node) => {
      const hex = getNodeType(node.type).color;
      return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    });
    for (let y = 0; y < result.height; y++) for (let x = 0; x < result.width; x++) {
      const i = y * result.width + x;
      const owner = result.owners[i];
      if (owner < 0) continue;
      const edge = (x > 0 && result.owners[i - 1] !== owner) ||
        (x + 1 < result.width && result.owners[i + 1] !== owner) ||
        (y > 0 && result.owners[i - result.width] !== owner) ||
        (y + 1 < result.height && result.owners[i + result.width] !== owner);
      const pixel = i * 4;
      if (edge) {
        image.data[pixel] = 35; image.data[pixel + 1] = 65; image.data[pixel + 2] = 67;
        image.data[pixel + 3] = state.stage === 2 ? 185 : 90;
      } else {
        [image.data[pixel], image.data[pixel + 1], image.data[pixel + 2]] = colors[owner];
        image.data[pixel + 3] = state.stage === 2 && state.selectedNodeId === state.nodes[owner].id ? 87 : 52;
      }
    }
    context.putImageData(image, 0, 0);
    const labels = state.nodes.map((node) => {
      const title = nodeShortLabel(node);
      const width = Math.ceil(Array.from(title).reduce((size, char) => size + (/[\x00-\x7f]/.test(char) ? 7 : 11), 12));
      const x = Math.max(TERRAIN_RECT.left + width / 2 + 3, Math.min(TERRAIN_RECT.right - width / 2 - 3, node.x));
      const y = Math.max(14, node.y - 21);
      return `<g class="terrain-map-label"><rect x="${x - width / 2}" y="${y - 10}" width="${width}" height="20" rx="4"/><text x="${x}" y="${y}">${escapeText(title)}</text></g>`;
    }).join('');
    $('districtLayer').innerHTML = `<image href="${canvas.toDataURL('image/png')}" x="${TERRAIN_RECT.left}" y="0" width="700" height="700" preserveAspectRatio="none" pointer-events="none"/>`;
    $('districtLabelLayer').innerHTML = labels;
    return;
  }
  lastTerrainDistrictResult = null;
  $('districtLabelLayer').innerHTML = '';
  $('subdistrictLayer').innerHTML = state.stage === 2
    ? makeDistrictSubareas(districts, state.nodes).map((area) => `<path class="subdistrict" d="${polygonPath(area.points)}"/>`).join('')
    : '';
  $('districtLayer').innerHTML = state.stage >= 2 ? districts.filter((district) => district.points.length >= 3).map((district) => {
    const node = state.nodes.find((item) => item.id === district.id);
    const type = getNodeType(district.type);
    const selected = state.stage === 2 && state.selectedNodeId === district.id;
    return `<g class="district${selected ? ' selected' : ''}${state.stage >= 3 ? ' subdued' : ''}" data-district="${escapeText(district.id)}"><path d="${polygonPath(district.points)}" fill="${type.color}"/><text x="${node.x}" y="${node.y - 17}">${escapeText(node.type === 'residential' ? nodeShortLabel(node) : type.name)}</text></g>`;
  }).join('') : '';
}

function drawWind() {
  const direction = WIND_DIRECTIONS.find((item) => item.id === state.wind) ?? WIND_DIRECTIONS[0];
  const { x: centerX, y: centerY } = clampWindPosition(
    state.windPosition ?? { x: terrainPlanningActive() ? 850 : 985, y: 82 }, terrainPlanningActive(),
  );
  const dx = direction.dx * 14;
  const dy = direction.dy * 14;
  $('windOverlay').innerHTML = `<g class="wind-handle" data-wind-handle="true"><title>拖动风向标改变位置</title><circle cx="${centerX}" cy="${centerY}" r="29" class="wind-disc"/><line x1="${centerX - dx}" y1="${centerY - dy}" x2="${centerX + dx}" y2="${centerY + dy}" class="wind-arrow" marker-end="url(#windArrowHead)"/></g>`;
}

function drawShipping() {
  const ports = state.nodes.filter((node) => node.type === 'seaHub');
  $('shippingAccess').innerHTML = ports.map((node) => {
    const channelX = Math.max(650, Math.min(1040, node.x - 16));
    return `<path d="M ${node.x} ${node.y} L ${channelX} ${northBranchY(channelX).toFixed(1)}" class="port-access"/>`;
  }).join('');
}

function boundaryRect() {
  const scale = state.boundaryScale / 100;
  const base = terrainPlanningActive() ? { centerX: 550, centerY: 350, width: 690, height: 690 } : { centerX: 541, centerY: 346, width: 906, height: 560 };
  const width = base.width * scale;
  const height = base.height * scale;
  return { x: base.centerX - width / 2, y: base.centerY - height / 2, width, height };
}

function drawBoundary() {
  const { x, y, width, height } = boundaryRect();
  for (const rect of [$('planBoundary'), document.querySelector('#planClip rect')]) {
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', width);
    rect.setAttribute('height', height);
  }
  const label = $('planningBoundaryLabel');
  if (label) label.setAttribute('x', terrainPlanningActive() ? 215 : 107);
}

function pathForCorridor(corridor) {
  const pts = corridor.points;
  if (pts.length === 2 && !corridor.kind) {
    const [a, b] = pts;
    const sign = corridor.id.length % 2 ? 1 : -1;
    const control = { x: (a.x + b.x) / 2 + (b.y - a.y) * .09 * sign, y: (a.y + b.y) / 2 - (b.x - a.x) * .09 * sign };
    return `M ${a.x} ${a.y} Q ${control.x.toFixed(1)} ${control.y.toFixed(1)} ${b.x} ${b.y}`;
  }
  return `M ${pts[0].x} ${pts[0].y} ${pts.slice(1).map((point) => `L ${point.x} ${point.y}`).join(' ')}`;
}

function drawMap() {
  const schematic = !terrainPlanningActive();
  const districts = schematic ? makeDistricts(state.nodes) : [];
  if (schematic) drawNeighborhoodTexture(districts);
  drawDistricts(districts);
  drawWind();
  drawShipping();
  drawBoundary();

  $('streetLayer').innerHTML = state.stage === 4
    ? makeStreetSegments(state.nodes, state.density).map((line) => `<path class="street-segment" d="${line.d}"/>`).join('')
    : '';

  $('corridorLayer').innerHTML = state.stage >= 3
    ? state.corridors.map((corridor) => {
      const d = pathForCorridor(corridor);
      const classes = `corridor${corridor.kind ? ` terrain-${corridor.kind}` : ''}${corridor.locked ? ' locked' : ''}${state.selectedCorridorId === corridor.id ? ' selected' : ''}`;
      const bridge = corridor.bridgeSegment ? (() => {
        const a = corridor.points[corridor.bridgeSegment[0]];
        const b = corridor.points[corridor.bridgeSegment[1]];
        return `<line class="bridge-bed" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/><line class="bridge-deck" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
      })() : '';
      return `<g data-corridor="${escapeText(corridor.id)}"><path class="${classes}" d="${d}"/>${bridge}<path class="corridor-hit" d="${d}"/></g>`;
    }).join('')
    : '';
  if (state.stage === 3 && terrainPlanningActive() && state.routeEdits[state.selectedCorridorId]?.via) {
    const via = state.routeEdits[state.selectedCorridorId].via;
    $('corridorLayer').insertAdjacentHTML('beforeend',
      '<g data-route-via="true" class="route-via"><circle class="route-via-halo" cx="' + via.x +
      '" cy="' + via.y + '" r="15"/><circle class="route-via-dot" cx="' + via.x +
      '" cy="' + via.y + '" r="8"/></g>');
  }
  if (state.stage === 3 && terrainPlanningActive()) {
    const selected = state.corridors.find((corridor) => corridor.id === state.selectedCorridorId);
    for (const point of selected?.tightTurns ?? []) $('corridorLayer').insertAdjacentHTML('beforeend',
      '<circle class="route-bend-warning" cx="' + point.x + '" cy="' + point.y +
      '" r="5"><title>局部弯度偏急 · 示意提醒</title></circle>');
  }

  $('nodeLayer').innerHTML = state.stage === 1 || state.stage === 2
    ? state.nodes.map((node) => {
      const type = getNodeType(node.type);
      const selected = node.id === state.selectedNodeId;
      const shape = getNodeShape(node.shape);
      const rx = node.radius * shape.scaleX;
      const ry = node.radius * shape.scaleY;
      const angle = nodeAngle(node);
      const resizeOffset = rotateOffset(node, rx * .72, ry * .72);
      const verticalExtent = Math.hypot(rx * Math.sin(angle * Math.PI / 180), ry * Math.cos(angle * Math.PI / 180));
      const rotation = angle ? ` transform="rotate(${angle} ${node.x} ${node.y})"` : '';
      const handle = state.stage === 1 && selected && !node.locked
        ? `<circle class="resize-handle" data-resize="${escapeText(node.id)}" cx="${(node.x + resizeOffset.x).toFixed(1)}" cy="${(node.y + resizeOffset.y).toFixed(1)}" r="7"/>`
        : '';
      const small = Math.min(rx, ry) < 25;
      return state.stage === 1
        ? `<g class="map-node${selected ? ' selected' : ''}" data-node="${escapeText(node.id)}"><title>${escapeText(nodeShortLabel(node))} · ${shape.name}${shape.id === 'circle' ? '' : ` · ${angle}°`}</title><ellipse class="outer" cx="${node.x}" cy="${node.y}" rx="${rx + 7}" ry="${ry + 7}"${rotation}/><ellipse class="main" cx="${node.x}" cy="${node.y}" rx="${rx}" ry="${ry}" fill="${type.color}" stroke="${type.color}"${rotation}/><text class="${small ? 'small-node-label' : ''}" x="${node.x}" y="${small ? node.y - verticalExtent - 10 : node.y + 2}">${escapeText(nodeShortLabel(node))}</text>${node.locked ? `<text x="${node.x}" y="${node.y + verticalExtent - 11}" style="font-size:11px">已锁定</text>` : ''}${handle}</g>`
        : `<g class="district-marker${selected ? ' selected' : ''}" data-node="${escapeText(node.id)}"><circle cx="${node.x}" cy="${node.y}" r="8" fill="${type.color}"/><circle class="marker-hit" cx="${node.x}" cy="${node.y}" r="19"/></g>`;
    }).join('')
    : '';
  $('mapHint').textContent = terrainPlanningActive() ? (state.stage === 2 ? '片区顺可开发的陆地延伸；水域、陡坡与离节点过远的山地留白。风向标可拖到空白处。' : state.stage === 3 ? '切换较短或缓坡候选，拖动蓝色必经点；橙点标出局部急弯。' : `${stageCopy[state.stage].hint} 地形图有真实水陆轮廓，走廊与街线仍是候选草案。`) : `${stageCopy[state.stage].hint}${state.stage === 2 ? ' 风向标可拖到空白处。' : ''}`;
}

function describeNode(id) {
  const node = state.nodes.find((item) => item.id === id);
  if (!node) return '<p class="selection-copy">选择一个节点查看建议。</p>';
  const type = getNodeType(node.type);
  const advisories = terrainPlanningActive() ? terrainNodeAdvisories(node) : getNodeAdvisories(node, state.nodes, state.wind);
  const notes = advisories.map((item) => `<div class="note${item.kind === 'good' ? '' : ' warn'}">${escapeText(item.text)}</div>`).join('');
  const chips = state.nodes.map((item) => `<button type="button" class="node-chip${item.id === id ? ' active' : ''}" data-select-node="${escapeText(item.id)}">${escapeText(nodeShortLabel(item))}</button>`).join('');
  const residenceNumber = node.type === 'residential' ? nodeShortLabel(node).replace('居住', '') : '';
  const title = residenceNumber ? `${type.name} ${residenceNumber}` : type.name;
  const terrainReasons = { cbd: '先以中心点组织周边片区；交通可达性与坡度还需检查。', landHub: '陆地交通枢纽只是位置假设；既有道路与轨道并未从高程图导入。', seaHub: '选择靠近岸线的位置；通航水道、水深与港区用地需要另行核实。' };
  const reason = terrainPlanningActive() ? terrainReasons[node.type] ?? type.reason : type.reason;
  const shapeControl = state.stage <= 2 ? `<label class="field-label shape-field" for="nodeShape">节点形状</label><select class="select" id="nodeShape">${NODE_SHAPES.map((shape) => `<option value="${shape.id}"${getNodeShape(node.shape).id === shape.id ? ' selected' : ''}>${shape.name}</option>`).join('')}</select>${getNodeShape(node.shape).id === 'circle' ? '' : `<label class="field-label shape-angle-label" for="nodeAngle">旋转角度 <strong id="nodeAngleValue">${nodeAngle(node)}°</strong></label><input class="range" id="nodeAngle" type="range" min="-90" max="90" step="1" value="${nodeAngle(node)}">`}` : '';
  return `<div class="selection-label">当前选中 / ${escapeText(node.id)}</div><div class="selection-title"><h3>${escapeText(title)}</h3><span class="type-pill">半径 ${node.radius}</span></div><p class="selection-copy">${escapeText(reason)}</p>${shapeControl}<div class="note-list">${notes}</div><div class="control-row"><button type="button" class="mini-button" data-action="toggle-node-lock">${node.locked ? '解除锁定' : '锁定位置'}</button><button type="button" class="mini-button danger" data-action="delete-node">删除节点</button></div><div class="node-list">${chips}</div>`;
}

function describeCorridor() {
  const corridor = state.corridors.find((item) => item.id === state.selectedCorridorId) ?? state.corridors[0];
  if (!corridor) return '<p class="selection-copy">没有可预览的主通道。</p>';
  state.selectedCorridorId = corridor.id;
  const start = state.nodes.find((node) => node.id === corridor.from);
  const end = state.nodes.find((node) => node.id === corridor.to);
  const startName = start ? nodeShortLabel(start) : corridor.from;
  const endName = end ? nodeShortLabel(end) : corridor.to;
  const details = terrainPlanningActive() ? '候选线沿连续、较平缓的陆地寻找通道；水域和陡坡被排除。它仍需结合既有道路、详细坡度与工程条件校核。'
    : corridor.bridgeSegment
    ? '这条连接跨越主河道。原型将跨河位置收束到候选桥位，避免每条道路各建一座桥。'
    : '两端位于同一侧，先以一条连续走廊连接，之后再细化道路等级与转弯。';
  const list = state.corridors.map((item) => {
    const a = state.nodes.find((node) => node.id === item.from);
    const b = state.nodes.find((node) => node.id === item.to);
    return `<button type="button" class="corridor-item${item.id === corridor.id ? ' active' : ''}" data-select-corridor="${escapeText(item.id)}"><span>${escapeText(a ? nodeShortLabel(a) : item.from)} → ${escapeText(b ? nodeShortLabel(b) : item.to)}</span>${item.locked ? '<b>锁定</b>' : ''}</button>`;
  }).join('');
  const edit = state.routeEdits[corridor.id] ?? {};
  const modes = [['balanced', '均衡'], ['short', '较短'], ['gentle', '缓坡']];
  const modeButtons = modes.map(([mode, label]) => '<button type="button" class="mini-button' + ((edit.mode ?? 'balanced') === mode ? ' active' : '') +
    '" data-action="route-mode-' + mode + '" aria-pressed="' + String((edit.mode ?? 'balanced') === mode) + '">' + label + '</button>').join('');
  const routeControls = terrainPlanningActive()
    ? '<div class="route-controls"><div class="field-label">走线偏好</div><div class="route-mode-list">' + modeButtons +
      '</div><div class="control-row"><button type="button" class="mini-button" data-action="' +
      (edit.via ? 'remove-route-via' : 'add-route-via') + '">' +
      (edit.via ? '移除必经点' : '＋ 添加必经点') + '</button></div>' +
      (edit.via ? '<p class="route-tip">拖动地图上的蓝色圆点；松开后按新必经点重算。</p>' : '') +
      (corridor.warning ? '<p class="route-warning" role="status">' + escapeText(corridor.warning) + '</p>' : '') +
      (corridor.tightTurns?.length ? '<p class="route-warning">图上橙色圆点提示 ' + corridor.tightTurns.length + ' 处局部急弯；这是几何提醒，尚未按道路等级校核半径。</p>' : '<p class="route-tip">当前线形未检出明显急弯；仍需按道路等级核对转弯半径。</p>') + '</div>'
    : '';
  return `<div class="selection-label">当前走廊 / ${escapeText(corridor.id)}</div><div class="selection-title"><h3>${escapeText(startName)} → ${escapeText(endName)}</h3><span class="type-pill">${terrainPlanningActive() ? corridor.kind === 'freight' ? '货运支线' : '主干候选' : corridor.bridgeSegment ? '跨河' : '同岸'}</span></div><p class="selection-copy">${details}</p>${routeControls}<div class="control-row"><button type="button" class="mini-button" data-action="toggle-corridor-lock">${corridor.locked ? '解除锁定' : terrainPlanningActive() ? '保留连接关系' : '锁定这段走线'}</button></div><div class="corridor-list">${list}</div>`;
}

function terrainNodeAdvisories(node) {
  const advice = [];
  if (!terrainIsLand(node.x, node.y)) advice.push({ kind: 'water', text: '圆心落在真实地形水域，建议移到陆地。' });
  if (node.type === 'industry' && !isDownwind(node, state.nodes, state.wind)) advice.push({ kind: 'wind', text: '工业区未处于当前假设风向下的 CBD 下风侧。' });
  if (node.type === 'industry' || node.type === 'resource') {
    const partner = state.nodes.find((item) => item.type === (node.type === 'industry' ? 'resource' : 'industry'));
    if (partner && Math.hypot(partner.x - node.x, partner.y - node.y) > 140) advice.push({ kind: 'freight', text: '资源区与工业区距离偏远，货运连接需要进一步检查。' });
  }
  if (node.type === 'seaHub') advice.push({ kind: 'shipping', text: '仅能从地形判断岸线，航道、水深和港区用地仍需单独核实。' });
  if (!advice.length) advice.push({ kind: 'good', text: '圆心位于陆地；坡度、交通容量与资源条件仍需校核。' });
  return advice;
}

function drawInspector() {
  const copy = stageCopy[state.stage];
  $('stageIndex').textContent = String(state.stage + 1).padStart(2, '0');
  $('inspectorHeading').textContent = copy.title;
  const terrainIntro = [
    '先观察旧金山湾真实地形、海岸与山地，再设定规划范围和假设风向。',
    '在地形图上直接拖动中心节点；新增节点和拖动节点会自动贴到陆地。',
    '片区从中心沿可开发陆地扩展；水域、陡坡和过远山地保持未规划。',
    '比较较短、均衡和缓坡走线；拖动必经点调整通道，橙点提示局部急弯。',
    '预览中心周边的街区几何；坡度与既有路网仍需校核。',
  ];
  $('stageIntro').textContent = terrainPlanningActive() ? terrainIntro[state.stage] : copy.intro;
  const terrainLearning = [
    '高程数据可帮助识别海岸、平地与山地；单凭高程无法确定全年风向、可航行水道或真实资源。',
    '先比较中心到就业、公园和海岸的距离，再检查工业区是否处于所设风向的下风侧。',
    copy.learning,
    '先确定中心之间的少量主干联系，再比较坡度与绕行；地形约束后的平滑线形仍要核对曲率。资源—工业另接货运支线，跨水桥位需要单独指定。',
    '地形图提供水陆边界与可见的起伏。道路、桥梁和航道尚未经过坡度、水深或交通容量校核。',
  ];
  $('learningText').textContent = terrainPlanningActive() ? terrainLearning[state.stage] : copy.learning;
  $('progressFill').style.width = `${(state.stage + 1) * 20}%`;
  $('backButton').disabled = state.stage === 0;
  $('nextButton').disabled = state.stage === 4;
  $('nextButton').textContent = state.stage === 3 ? '预览街区 →' : '下一步 →';
  document.querySelectorAll('#stageNav button').forEach((button) => {
    const index = Number(button.dataset.stage);
    button.classList.toggle('active', index === state.stage);
    button.classList.toggle('done', index < state.stage);
    button.setAttribute('aria-current', index === state.stage ? 'step' : 'false');
  });
  if (state.stage === 0) {
    $('selectionPanel').innerHTML = terrainPlanningActive() ? `<div class="selection-label">场地判断</div><div class="selection-title"><h3>旧金山湾地形</h3></div><div class="note-list"><div class="note">底图是 4096×4096 真实高程数据的设色预览，片区按其水陆轮廓裁切。</div><div class="note">风向是可调整的规划假设；航道和现有道路没有从高程图中推断。</div></div>` : `<div class="selection-label">场地判断</div><div class="selection-title"><h3>水 · 坡 · 风 · 航道</h3></div><div class="note-list"><div class="note">西北丘陵：示意等高线提示道路顺坡转向。</div><div class="note">中央河道：跨河点集中；蓝色虚线沿河口支流表示候选航道。</div><div class="note">主导风向：改变方向后，未锁定的工业区会移至中心下风侧。</div></div>`;
    $('stepControls').innerHTML = `<div class="control-heading">场地参数</div><label class="field-label" for="windDirection">主导风向（示意）</label><select class="select" id="windDirection">${WIND_DIRECTIONS.map((item) => `<option value="${item.id}"${state.wind === item.id ? ' selected' : ''}>${item.name} → ${item.to}</option>`).join('')}</select><label class="field-label field-gap" for="areaScale">规划范围 <strong id="areaValue">${state.boundaryScale}%</strong></label><input id="areaScale" class="range" type="range" min="70" max="100" step="1" value="${state.boundaryScale}"><div class="control-card"><strong>场地信息来源</strong><p>${terrainPlanningActive() ? '旧金山湾高程图提供地形与水陆轮廓；风向仍是规划假设，航道与既有道路须另行核实。' : '根据 River Delta 的文字介绍绘制概念底图。等高线、风向和航道为规划假设，并非游戏实测数据；实际坡度、航路与资源须在游戏里核实。'}</p></div>`;
  } else if (state.stage === 1) {
    $('selectionPanel').innerHTML = describeNode(state.selectedNodeId);
    $('stepControls').innerHTML = `<div class="control-heading">增加一个节点</div><label class="field-label" for="nodeType">类型</label><select class="select" id="nodeType">${NODE_TYPES.map((item) => `<option value="${item.type}"${state.addType === item.type ? ' selected' : ''}>${escapeText(item.name)}</option>`).join('')}</select><div class="control-row"><button type="button" class="mini-button" data-action="add-node">＋ 添加节点</button><button type="button" class="mini-button" data-action="recommend">重新推荐</button></div>`;
  } else if (state.stage === 2) {
    const node = state.nodes.find((item) => item.id === state.selectedNodeId);
    $('selectionPanel').innerHTML = describeNode(state.selectedNodeId);
    $('stepControls').innerHTML = `<div class="control-heading">片区边界</div><label class="field-label" for="districtRadius">${node ? escapeText(getNodeType(node.type).name) : '选中片区'}的影响范围 <strong id="districtRadiusValue">${node?.radius ?? 40}</strong></label><input id="districtRadius" class="range" type="range" min="16" max="88" step="1" value="${node?.radius ?? 40}" ${!node || node.locked ? 'disabled' : ''}><div class="control-card"><strong>边界会随节点调整</strong><p>${terrainPlanningActive() ? '片区按节点形状沿平缓陆地延伸，水域、陡坡和过远山地留白。点击色块、拖动中心或调整范围。' : '点击片区、调整形状或影响范围。虚线只表达规划关系，河流把陆上片区自然分开。'}</p></div>`;
  } else if (state.stage === 3) {
    $('selectionPanel').innerHTML = describeCorridor();
    $('stepControls').innerHTML = `<div class="control-card"><strong>${terrainPlanningActive() ? `${state.corridors.length} 条候选主干与货运联系` : `${state.corridors.filter((item) => item.bridgeSegment).length} 条跨河联系`} · ${state.lockedCorridors.length} 条已保留</strong><p>${terrainPlanningActive() ? '先连主要中心，沿可通行陆地绕开水域和陡坡；未画出的跨水联系需要另选桥位。线位仍须核实既有路网与工程条件。' : '重算只改变未锁定走廊的候选桥位；移动节点时，已锁定走线保留中间控制点。'}</p>${terrainPlanningActive() ? '' : '<button type="button" class="mini-button" data-action="regenerate">↻ 重新生成走线</button>'}</div>`;
  } else {
    const segmentCount = makeStreetSegments(state.nodes, state.density).length;
    $('selectionPanel').innerHTML = `<div class="selection-label">本轮预览</div><div class="selection-title"><h3>${segmentCount} 段局部街线</h3><span class="type-pill">示意</span></div><p class="selection-copy">不同节点周围的街道方向略有变化；河道会遮挡水上街线，主通道仍保留候选桥位。</p><div class="note-list"><div class="note">可返回步骤 02 移动节点，街区道路会跟着更新。</div><div class="note warn">这是几何预览，不代表已经满足游戏里的道路坡度、交通容量或建筑分区要求。</div></div>`;
    $('stepControls').innerHTML = `<div class="control-heading">街区尺度</div><label class="field-label" for="densityRange">局部街道密度 <strong id="densityValue">${['', '疏', '中', '密'][state.density]}</strong></label><input id="densityRange" class="range" type="range" min="1" max="3" step="1" value="${state.density}"><div class="control-card"><strong>观察重点</strong><p>看主路与街区道路能否顺畅衔接，也留意公园、岸线和坡地有没有被细路切得太碎。</p></div>`;
  }
}

function render() {
  drawMap();
  drawInspector();
  updateHeightmapView();
  persist();
}

function refreshCorridors() {
  const terrainActive = terrainPlanningActive();
  state.corridors = terrainActive
    ? terrainConnections(state.nodes, state.corridors, state.lockedCorridors, terrainPlanningGrid, { originX: TERRAIN_RECT.left, mapSize: 700, metersPerCell: 443 })
    : generateCorridors(state.nodes, state.variant, state.corridors, state.lockedCorridors);
  if (terrainActive && terrainPlanningGrid) state.corridors = state.corridors.map((corridor) => {
    const designed = designTerrainRoute(terrainPlanningGrid, corridor, state.nodes, state.routeEdits[corridor.id] ?? {},
      { originX: TERRAIN_RECT.left, mapSize: 700, metersPerCell: 443 });
    return { ...designed, tightTurns: findTightTurns(designed.points) };
  });
  state.lockedCorridors = state.lockedCorridors.filter((id) => state.corridors.some((corridor) => corridor.id === id));
  if (!state.corridors.some((corridor) => corridor.id === state.selectedCorridorId)) state.selectedCorridorId = state.corridors[0]?.id ?? null;
}

function activateTerrainPlan() {
  if (state.mapId !== 'san-francisco-bay') {
    state.mapId = 'san-francisco-bay';
    state.windPosition = null;
    state.nodes = placeTerrainNodes(makeDefaultNodes(), terrainIsLand);
    state.selectedNodeId = 'cbd';
    state.boundaryScale = 100;
    state.lockedCorridors = [];
  }
  planningOverlayVisible = true;
  refreshCorridors();
}

function handleAction(action) {
  if (action === 'toggle-node-lock') {
    state.nodes = state.nodes.map((node) => node.id === state.selectedNodeId ? { ...node, locked: !node.locked } : node);
  } else if (action === 'delete-node') {
    state.nodes = state.nodes.filter((node) => node.id !== state.selectedNodeId);
    state.selectedNodeId = state.nodes[0]?.id ?? null;
    refreshCorridors();
  } else if (action === 'add-node') {
    const type = state.addType;
    const serial = Math.max(0, ...state.nodes.filter((node) => node.type === type).map((node) => Number(node.id.match(/-(\d+)$/)?.[1] ?? 0))) + 1;
    const id = `${type}-${serial}`;
    const occupied = state.nodes.length;
    let x = Math.min(MAP_BOUNDS.maxX, 380 + (occupied * 77) % 455);
    let y = Math.min(MAP_BOUNDS.maxY, 210 + (occupied * 53) % 345);
    if (terrainPlanningActive()) ({ x, y } = nearestLandPoint({ x, y }, terrainIsLand));
    state.nodes = [...state.nodes, { id, type, x, y, radius: 40, shape: 'circle', angle: 0, locked: false }];
    state.selectedNodeId = id;
    refreshCorridors();
  } else if (action === 'recommend') {
    state.nodes = terrainPlanningActive() ? placeTerrainNodes(makeDefaultNodes(), terrainIsLand) : reflowSupplyNodes(makeDefaultNodes(), state.wind);
    state.selectedNodeId = 'cbd';
    state.lockedCorridors = [];
    state.variant = 0;
    state.routeEdits = {};
    refreshCorridors();
  } else if (action.startsWith('route-mode-') && terrainPlanningActive()) {
    const mode = action.slice('route-mode-'.length);
    if (['balanced', 'short', 'gentle'].includes(mode)) {
      state.routeEdits[state.selectedCorridorId] = { ...state.routeEdits[state.selectedCorridorId], mode };
      refreshCorridors();
    }
  } else if (action === 'add-route-via' && terrainPlanningActive()) {
    const corridor = state.corridors.find((item) => item.id === state.selectedCorridorId);
    if (corridor) {
      const point = corridor.points[Math.floor(corridor.points.length / 2)];
      state.routeEdits[corridor.id] = { ...state.routeEdits[corridor.id], via: { x: point.x, y: point.y } };
      refreshCorridors();
    }
  } else if (action === 'remove-route-via' && terrainPlanningActive()) {
    const { via, ...remaining } = state.routeEdits[state.selectedCorridorId] ?? {};
    state.routeEdits[state.selectedCorridorId] = remaining;
    refreshCorridors();
  } else if (action === 'toggle-corridor-lock') {
    const id = state.selectedCorridorId;
    state.lockedCorridors = state.lockedCorridors.includes(id)
      ? state.lockedCorridors.filter((item) => item !== id)
      : [...state.lockedCorridors, id];
    refreshCorridors();
  } else if (action === 'regenerate') {
    state.variant += 1;
    refreshCorridors();
  }
  render();
}

function exportPlan() {
  const terrainDistricts = terrainPlanningActive() && terrainPlanningGrid ? makeTerrainDistricts(terrainPlanningGrid, state.nodes, {
    originX: TERRAIN_RECT.left, mapSize: 700, metersPerCell: 443, maxGrade: .18,
  }) : null;
  const payload = {
    schema: 'cs2-urban-planning-guide/prototype-2',
    map: terrainPlanningActive() ? 'San Francisco Bay — real terrain, provisional planning geometry' : 'River Delta — schematic, not extracted game data',
    exportedAt: new Date().toISOString(),
    nodes: state.nodes,
    districts: terrainDistricts ? state.nodes.map((node, index) => ({
      id: node.id, type: node.type,
      assignedCells: terrainDistricts.owners.reduce((count, owner) => count + (owner === index), 0),
    })) : makeDistricts(state.nodes),
    terrainDistrictRaster: terrainDistricts ? {
      width: terrainDistricts.width, height: terrainDistricts.height,
      originX: terrainDistricts.originX, originY: terrainDistricts.originY,
      mapSize: terrainDistricts.mapSize, nodeIds: terrainDistricts.nodeIds,
      owners: Array.from(terrainDistricts.owners),
    } : null,
    corridors: state.corridors,
    routeEdits: state.routeEdits,
    streetDensity: state.density,
    planningBoundaryPercent: state.boundaryScale,
    assumedWindDirection: state.wind,
    shippingChannel: terrainPlanningActive() ? 'unknown; no channel inferred from elevation' : 'schematic north distributary; verify in game',
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = terrainPlanningActive() ? 'san-francisco-bay-planning-prototype.json' : 'river-delta-planning-prototype.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

map.addEventListener('pointerdown', (event) => {
  if (state.stage === 3 && terrainPlanningActive() && event.target.closest('[data-route-via]')) {
    dragging = { kind: 'route-via', id: state.selectedCorridorId };
    map.setPointerCapture(event.pointerId);
    return;
  }
  if (event.target.closest('[data-wind-handle]')) {
    const point = svgPoint(event);
    const center = clampWindPosition(state.windPosition ?? { x: terrainPlanningActive() ? 850 : 985, y: 82 }, terrainPlanningActive());
    dragging = { kind: 'wind', offsetX: center.x - point.x, offsetY: center.y - point.y };
    map.setPointerCapture(event.pointerId);
    return;
  }
  const nodeElement = event.target.closest('[data-node]');
  if (nodeElement && (state.stage === 1 || state.stage === 2)) {
    const id = nodeElement.dataset.node;
    const node = state.nodes.find((item) => item.id === id);
    state.selectedNodeId = id;
    if (!node.locked) {
      const position = svgPoint(event);
      dragging = {
        id, kind: event.target.hasAttribute('data-resize') ? 'resize' : 'move',
        offsetX: node.x - position.x, offsetY: node.y - position.y,
      };
      map.setPointerCapture(event.pointerId);
    }
    render();
  } else {
    const district = event.target.closest('[data-district]');
    if (district && state.stage === 2) {
      state.selectedNodeId = district.dataset.district;
      render();
      return;
    }
    if (state.stage === 2 && terrainPlanningActive() && lastTerrainDistrictResult) {
      const point = svgPoint(event);
      const id = terrainDistrictAt(lastTerrainDistrictResult, point.x, point.y);
      if (id) { state.selectedNodeId = id; render(); return; }
    }
    const route = event.target.closest('[data-corridor]');
    if (route && state.stage >= 3) {
      state.selectedCorridorId = route.dataset.corridor;
      render();
    }
  }
});

map.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  const position = svgPoint(event);
  if (dragging.kind === 'wind') {
    state.windPosition = clampWindPosition({ x: position.x + dragging.offsetX, y: position.y + dragging.offsetY }, terrainPlanningActive());
    drawWind();
    persist();
    return;
  }
  if (dragging.kind === 'route-via') {
    const point = nearestLandPoint(position, terrainIsLand);
    state.routeEdits[dragging.id] = { ...state.routeEdits[dragging.id], via: point };
    for (const circle of $('corridorLayer').querySelectorAll('[data-route-via] circle')) {
      circle.setAttribute('cx', point.x);
      circle.setAttribute('cy', point.y);
    }
    return;
  }
  if (dragging.kind === 'move') {
    if (terrainPlanningActive()) {
      const point = nearestLandPoint({ x: position.x + dragging.offsetX, y: position.y + dragging.offsetY }, terrainIsLand);
      state.nodes = state.nodes.map((node) => node.id === dragging.id && !node.locked ? { ...node, ...point } : node);
    } else {
      state.nodes = moveNode(state.nodes, dragging.id, position.x + dragging.offsetX, position.y + dragging.offsetY);
    }
  } else {
    const node = state.nodes.find((item) => item.id === dragging.id);
    state.nodes = resizeNode(state.nodes, dragging.id, shapeDistance(node, position.x - node.x, position.y - node.y) / .99);
  }
  if (!terrainPlanningActive()) refreshCorridors();
  drawMap();
  persist();
});

map.addEventListener('pointerup', (event) => {
  if (!dragging) return;
  const kind = dragging.kind;
  dragging = null;
  if (map.hasPointerCapture(event.pointerId)) map.releasePointerCapture(event.pointerId);
  if (kind === 'route-via') {
    refreshCorridors();
    render();
    return;
  }
  if (kind !== 'wind') { if (terrainPlanningActive()) { refreshCorridors(); drawMap(); } drawInspector(); }
  persist();
});
map.addEventListener('pointercancel', () => { dragging = null; render(); });

$('stageNav').addEventListener('click', (event) => {
  const button = event.target.closest('[data-stage]');
  if (!button) return;
  state.stage = Number(button.dataset.stage);
  if (terrainPlanningActive()) planningOverlayVisible = true;
  else if (state.stage > 0) heightmapVisible = false;
  render();
});
$('backButton').addEventListener('click', () => { state.stage = Math.max(0, state.stage - 1); render(); });
$('nextButton').addEventListener('click', () => { state.stage = Math.min(4, state.stage + 1); if (terrainPlanningActive()) planningOverlayVisible = true; else if (state.stage > 0) heightmapVisible = false; render(); });
$('resetButton').addEventListener('click', () => { state = freshState(); if (terrainPlanningActive()) { state.mapId = 'san-francisco-bay'; state.nodes = placeTerrainNodes(state.nodes, terrainIsLand); refreshCorridors(); } render(); });
$('canvasSizeButton').addEventListener('click', () => { focusMode = !focusMode; inspectorHidden = false; renderCanvasMode(); });
$('heightmapToggle').addEventListener('click', () => { if (terrainPlanningActive()) planningOverlayVisible = !planningOverlayVisible; else heightmapVisible = !heightmapVisible; updateHeightmapView(); });
$('terrainColorToggle').addEventListener('click', () => { heightmapColorVisible = !heightmapColorVisible; updateHeightmapView(); });
$('heightmapFile').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  heightmapLoadToken += 1;
  const candidateUrl = URL.createObjectURL(file);
  try {
    const metadata = readPngHeader(new Uint8Array(await file.slice(0, 29).arrayBuffer()));
    if (!metadata) throw new Error('无法识别 PNG 高程图文件。');
    const error = validateTerrainPreview({ name: file.name, ...metadata });
    if (error) throw new Error(error);
    const image = new Image();
    image.src = candidateUrl;
    await image.decode();
    if (image.naturalWidth !== metadata.width || image.naturalHeight !== metadata.height) throw new Error('图像尺寸与 PNG 文件头不一致。');
    if (heightmapUrl?.startsWith('blob:')) URL.revokeObjectURL(heightmapUrl);
    heightmapUrl = candidateUrl;
    heightmapName = file.name;
    heightmapMetadata = metadata;
    colorPreviewAvailable = false;
    if (/^san-francisco-bay-heightmap\.png$/i.test(file.name)) {
      try { colorPreviewAvailable = (await fetch('./local-samples/san-francisco-bay-terrain-preview.png', { method: 'HEAD' })).ok; }
      catch { /* The optional local-only render is unavailable. */ }
    }
    heightmapColorVisible = colorPreviewAvailable;
    heightmapVisible = true;
    if (/^san-francisco-bay-heightmap\.png$/i.test(file.name) && colorPreviewAvailable) {
      terrainLandRaster = await makeTerrainLandRaster('./local-samples/san-francisco-bay-terrain-preview.png');
      terrainPlanningGrid = makeTerrainPlanningGrid(image, terrainLandRaster);
      lastTerrainDistrictKey = '';
      activateTerrainPlan();
    } else { terrainLandRaster = null; terrainPlanningGrid = null; lastTerrainDistrictKey = ''; }
    render();
  } catch (error) {
    URL.revokeObjectURL(candidateUrl);
    $('heightmapStatus').textContent = error.message || '无法读取这份高程图。';
  }
  event.target.value = '';
});

async function loadBuiltInHeightmap() {
  const token = ++heightmapLoadToken;
  const name = 'san-francisco-bay-heightmap.png';
  const response = await fetch(`./local-samples/${name}`, { cache: 'no-store' });
  if (!response.ok) return;
  const blob = await response.blob();
  const metadata = readPngHeader(new Uint8Array(await blob.slice(0, 29).arrayBuffer()));
  const error = metadata ? validateHeightmap({ name, ...metadata }) : '内置高程图不是有效的 PNG。';
  if (error) throw new Error(error);
  const candidateUrl = URL.createObjectURL(blob);
  let installed = false;
  try {
    const image = new Image();
    image.src = candidateUrl;
    await image.decode();
    if (image.naturalWidth !== metadata.width || image.naturalHeight !== metadata.height) throw new Error('内置高程图尺寸不匹配。');
    let hasColorPreview = false;
    try { hasColorPreview = (await fetch('./local-samples/san-francisco-bay-terrain-preview.png', { method: 'HEAD' })).ok; }
    catch { /* The grayscale source can still be shown. */ }
    const landRaster = hasColorPreview ? await makeTerrainLandRaster('./local-samples/san-francisco-bay-terrain-preview.png') : null;
    const planningGrid = makeTerrainPlanningGrid(image, landRaster);
    if (token !== heightmapLoadToken) return;
    if (heightmapUrl?.startsWith('blob:')) URL.revokeObjectURL(heightmapUrl);
    heightmapUrl = candidateUrl;
    heightmapName = name;
    heightmapMetadata = metadata;
    colorPreviewAvailable = hasColorPreview;
    heightmapColorVisible = colorPreviewAvailable;
    heightmapVisible = true;
    terrainLandRaster = landRaster;
    terrainPlanningGrid = planningGrid;
    lastTerrainDistrictKey = '';
    if (terrainLandRaster) activateTerrainPlan();
    installed = true;
    render();
  } finally {
    if (!installed) URL.revokeObjectURL(candidateUrl);
  }
}
$('inspectorToggle').addEventListener('click', () => { inspectorHidden = !inspectorHidden; renderCanvasMode(); });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && focusMode) { focusMode = false; inspectorHidden = false; renderCanvasMode(); }
});
$('exportButton').addEventListener('click', exportPlan);
$('selectionPanel').addEventListener('click', (event) => {
  const node = event.target.closest('[data-select-node]');
  const route = event.target.closest('[data-select-corridor]');
  const action = event.target.closest('[data-action]');
  if (node) { state.selectedNodeId = node.dataset.selectNode; render(); }
  else if (route) { state.selectedCorridorId = route.dataset.selectCorridor; render(); }
  else if (action) handleAction(action.dataset.action);
});
$('selectionPanel').addEventListener('change', (event) => {
  if (event.target.id === 'nodeShape') {
    const shape = getNodeShape(event.target.value).id;
    state.nodes = state.nodes.map((node) => node.id === state.selectedNodeId ? { ...node, shape } : node);
    render();
  } else if (event.target.id === 'nodeAngle') render();
});
$('selectionPanel').addEventListener('input', (event) => {
  if (event.target.id !== 'nodeAngle') return;
  const angle = Number(event.target.value);
  state.nodes = state.nodes.map((node) => node.id === state.selectedNodeId ? { ...node, angle } : node);
  $('nodeAngleValue').textContent = `${angle}°`;
  drawMap();
  persist();
});
$('stepControls').addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]');
  if (action) handleAction(action.dataset.action);
});
$('stepControls').addEventListener('change', (event) => {
  if (event.target.id === 'nodeType') { state.addType = event.target.value; persist(); }
  if (event.target.id === 'districtRadius') render();
  if (event.target.id === 'windDirection') {
    state.wind = event.target.value;
    if (!terrainPlanningActive()) state.nodes = reflowSupplyNodes(state.nodes, state.wind);
    refreshCorridors();
    render();
  }
});
$('stepControls').addEventListener('input', (event) => {
  if (event.target.id === 'areaScale') {
    state.boundaryScale = Number(event.target.value);
    $('areaValue').textContent = `${state.boundaryScale}%`;
    drawBoundary();
    persist();
  } else if (event.target.id === 'densityRange') {
    state.density = Number(event.target.value);
    $('densityValue').textContent = ['', '疏', '中', '密'][state.density];
    drawMap();
    persist();
  } else if (event.target.id === 'districtRadius') {
    state.nodes = resizeNode(state.nodes, state.selectedNodeId, Number(event.target.value));
    $('districtRadiusValue').textContent = event.target.value;
    const pill = $('selectionPanel').querySelector('.type-pill');
    if (pill) pill.textContent = `半径 ${event.target.value}`;
    refreshCorridors();
    drawMap();
    persist();
  }
});

drawTerrain();
renderCanvasMode();
render();
loadBuiltInHeightmap().catch((error) => {
  $('heightmapStatus').textContent = `旧金山湾样例载入失败：${error.message}`;
});
