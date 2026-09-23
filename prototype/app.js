import {
  MAP_BOUNDS, NODE_TYPES, getNodeType, makeDefaultNodes, moveNode, resizeNode,
  northBranchY, isWater, WIND_DIRECTIONS, recommendIndustryPosition, recommendResourcePosition,
  generateCorridors, makeStreetSegments, getNodeAdvisories,
} from './planner.js';
import { makeDistricts, makeDistrictSubareas, polygonContains } from './districts.js';
import { makeWaterPolygons, polygonPath } from './terrain.js';

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
    hint: '拖动圆圈调整位置；拖动右下角的小点调整影响范围。',
  },
  {
    title: '生成片区',
    intro: '节点已转为连续的片区边界。白色陆地上的虚线是建议边界，水体自然把片区分开。',
    learning: '片区是讨论道路、公共服务和开发顺序的中间尺度，不是行政区，也不是单一用途的分区。调整中心或影响范围时，边界会重新分配。',
    hint: '点击片区选择，拖动中心标记或调右侧影响范围；返回上一步可增删节点。',
  },
  {
    title: '安排主通道',
    intro: '橙色线表示优先规划的重要出行走廊。跨河段集中在候选桥位，可以锁定喜欢的连接再重算。',
    learning: '主通道不等于所有道路都要加宽。跨河点少时，应留意绕行；中心间的短联系也可以优先考虑步行与公交。',
    hint: '点击橙色走线查看并锁定；移动节点或重算，比较桥位变化。',
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
    stage: 0, nodes, selectedNodeId: 'cbd', selectedCorridorId: 'landHub-cbd', wind: 'NW',
    corridors: generateCorridors(nodes), lockedCorridors: [],
    variant: 0, density: 2, boundaryScale: 100, addType: 'park',
  };
}

function readSaved() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey));
    if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.corridors)) return null;
    if (!value.nodes.every((node) => getNodeType(node.type) && Number.isFinite(node.x) && Number.isFinite(node.y))) return null;
    return { ...freshState(), ...value, stage: Math.min(4, Math.max(0, value.stage ?? 1)) };
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
  const x1 = 967 - direction.dx * 24;
  const y1 = 88 - direction.dy * 24;
  const x2 = 967 + direction.dx * 24;
  const y2 = 88 + direction.dy * 24;
  $('windOverlay').innerHTML = `<rect x="898" y="43" width="138" height="94" rx="9" class="wind-card"/><text x="912" y="63" class="wind-title">主导风向 · 示意</text><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="wind-arrow" marker-end="url(#windArrowHead)"/><text x="912" y="124" class="wind-caption">${direction.name} → ${direction.to}</text>`;
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
  const width = 906 * scale;
  const height = 560 * scale;
  return { x: 541 - width / 2, y: 346 - height / 2, width, height };
}

function drawBoundary() {
  const { x, y, width, height } = boundaryRect();
  for (const rect of [$('planBoundary'), document.querySelector('#planClip rect')]) {
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', width);
    rect.setAttribute('height', height);
  }
}

function pathForCorridor(corridor) {
  const pts = corridor.points;
  if (pts.length === 2) {
    const [a, b] = pts;
    const sign = corridor.id.length % 2 ? 1 : -1;
    const control = { x: (a.x + b.x) / 2 + (b.y - a.y) * .09 * sign, y: (a.y + b.y) / 2 - (b.x - a.x) * .09 * sign };
    return `M ${a.x} ${a.y} Q ${control.x.toFixed(1)} ${control.y.toFixed(1)} ${b.x} ${b.y}`;
  }
  return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y} L ${pts[2].x} ${pts[2].y} L ${pts[3].x} ${pts[3].y}`;
}

function drawMap() {
  const districts = makeDistricts(state.nodes);
  drawNeighborhoodTexture(districts);
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
      const classes = `corridor${corridor.locked ? ' locked' : ''}${state.selectedCorridorId === corridor.id ? ' selected' : ''}`;
      const bridge = corridor.bridgeSegment ? (() => {
        const a = corridor.points[corridor.bridgeSegment[0]];
        const b = corridor.points[corridor.bridgeSegment[1]];
        return `<line class="bridge-bed" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/><line class="bridge-deck" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
      })() : '';
      return `<g data-corridor="${escapeText(corridor.id)}"><path class="${classes}" d="${d}"/>${bridge}<path class="corridor-hit" d="${d}"/></g>`;
    }).join('')
    : '';

  $('nodeLayer').innerHTML = state.stage === 1 || state.stage === 2
    ? state.nodes.map((node) => {
      const type = getNodeType(node.type);
      const selected = node.id === state.selectedNodeId;
      const handle = state.stage === 1 && selected && !node.locked
        ? `<circle class="resize-handle" data-resize="${escapeText(node.id)}" cx="${(node.x + node.radius * .72).toFixed(1)}" cy="${(node.y + node.radius * .72).toFixed(1)}" r="7"/>`
        : '';
      return state.stage === 1
        ? `<g class="map-node${selected ? ' selected' : ''}" data-node="${escapeText(node.id)}"><circle class="outer" cx="${node.x}" cy="${node.y}" r="${node.radius + 7}"/><circle class="main" cx="${node.x}" cy="${node.y}" r="${node.radius}" fill="${type.color}" stroke="${type.color}"/><text x="${node.x}" y="${node.y + 2}">${escapeText(nodeShortLabel(node))}</text>${node.locked ? `<text x="${node.x}" y="${node.y + node.radius - 11}" style="font-size:11px">已锁定</text>` : ''}${handle}</g>`
        : `<g class="district-marker${selected ? ' selected' : ''}" data-node="${escapeText(node.id)}"><circle cx="${node.x}" cy="${node.y}" r="8" fill="${type.color}"/><circle class="marker-hit" cx="${node.x}" cy="${node.y}" r="19"/></g>`;
    }).join('')
    : '';
  $('mapHint').textContent = stageCopy[state.stage].hint;
}

function describeNode(id) {
  const node = state.nodes.find((item) => item.id === id);
  if (!node) return '<p class="selection-copy">选择一个节点查看建议。</p>';
  const type = getNodeType(node.type);
  const advisories = getNodeAdvisories(node, state.nodes, state.wind);
  const notes = advisories.map((item) => `<div class="note${item.kind === 'good' ? '' : ' warn'}">${escapeText(item.text)}</div>`).join('');
  const chips = state.nodes.map((item) => `<button type="button" class="node-chip${item.id === id ? ' active' : ''}" data-select-node="${escapeText(item.id)}">${escapeText(nodeShortLabel(item))}</button>`).join('');
  const residenceNumber = node.type === 'residential' ? nodeShortLabel(node).replace('居住', '') : '';
  const title = residenceNumber ? `${type.name} ${residenceNumber}` : type.name;
  return `<div class="selection-label">当前选中 / ${escapeText(node.id)}</div><div class="selection-title"><h3>${escapeText(title)}</h3><span class="type-pill">半径 ${node.radius}</span></div><p class="selection-copy">${escapeText(type.reason)}</p><div class="note-list">${notes}</div><div class="control-row"><button type="button" class="mini-button" data-action="toggle-node-lock">${node.locked ? '解除锁定' : '锁定位置'}</button><button type="button" class="mini-button danger" data-action="delete-node">删除节点</button></div><div class="node-list">${chips}</div>`;
}

function describeCorridor() {
  const corridor = state.corridors.find((item) => item.id === state.selectedCorridorId) ?? state.corridors[0];
  if (!corridor) return '<p class="selection-copy">没有可预览的主通道。</p>';
  state.selectedCorridorId = corridor.id;
  const start = state.nodes.find((node) => node.id === corridor.from);
  const end = state.nodes.find((node) => node.id === corridor.to);
  const startName = start ? nodeShortLabel(start) : corridor.from;
  const endName = end ? nodeShortLabel(end) : corridor.to;
  const details = corridor.bridgeSegment
    ? '这条连接跨越主河道。原型将跨河位置收束到候选桥位，避免每条道路各建一座桥。'
    : '两端位于同一侧，先以一条连续走廊连接，之后再细化道路等级与转弯。';
  const list = state.corridors.map((item) => {
    const a = state.nodes.find((node) => node.id === item.from);
    const b = state.nodes.find((node) => node.id === item.to);
    return `<button type="button" class="corridor-item${item.id === corridor.id ? ' active' : ''}" data-select-corridor="${escapeText(item.id)}"><span>${escapeText(a ? nodeShortLabel(a) : item.from)} → ${escapeText(b ? nodeShortLabel(b) : item.to)}</span>${item.locked ? '<b>锁定</b>' : ''}</button>`;
  }).join('');
  return `<div class="selection-label">当前走廊 / ${escapeText(corridor.id)}</div><div class="selection-title"><h3>${escapeText(startName)} → ${escapeText(endName)}</h3><span class="type-pill">${corridor.bridgeSegment ? '跨河' : '同岸'}</span></div><p class="selection-copy">${details}</p><div class="control-row"><button type="button" class="mini-button" data-action="toggle-corridor-lock">${corridor.locked ? '解除锁定' : '锁定这段走线'}</button></div><div class="corridor-list">${list}</div>`;
}

function drawInspector() {
  const copy = stageCopy[state.stage];
  $('stageIndex').textContent = String(state.stage + 1).padStart(2, '0');
  $('inspectorHeading').textContent = copy.title;
  $('stageIntro').textContent = copy.intro;
  $('learningText').textContent = copy.learning;
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
    $('selectionPanel').innerHTML = `<div class="selection-label">场地判断</div><div class="selection-title"><h3>水 · 坡 · 风 · 航道</h3></div><div class="note-list"><div class="note">西北丘陵：示意等高线提示道路顺坡转向。</div><div class="note">中央河道：跨河点集中；蓝色虚线沿河口支流表示候选航道。</div><div class="note">主导风向：改变方向后，未锁定的工业区会移至中心下风侧。</div></div>`;
    $('stepControls').innerHTML = `<div class="control-heading">场地参数</div><label class="field-label" for="windDirection">主导风向（示意）</label><select class="select" id="windDirection">${WIND_DIRECTIONS.map((item) => `<option value="${item.id}"${state.wind === item.id ? ' selected' : ''}>${item.name} → ${item.to}</option>`).join('')}</select><label class="field-label field-gap" for="areaScale">规划范围 <strong id="areaValue">${state.boundaryScale}%</strong></label><input id="areaScale" class="range" type="range" min="70" max="100" step="1" value="${state.boundaryScale}"><div class="control-card"><strong>场地信息来源</strong><p>根据 River Delta 的文字介绍绘制概念底图。等高线、风向和航道为规划假设，并非游戏实测数据；实际坡度、航路与资源须在游戏里核实。</p></div>`;
  } else if (state.stage === 1) {
    $('selectionPanel').innerHTML = describeNode(state.selectedNodeId);
    $('stepControls').innerHTML = `<div class="control-heading">增加一个节点</div><label class="field-label" for="nodeType">类型</label><select class="select" id="nodeType">${NODE_TYPES.map((item) => `<option value="${item.type}"${state.addType === item.type ? ' selected' : ''}>${escapeText(item.name)}</option>`).join('')}</select><div class="control-row"><button type="button" class="mini-button" data-action="add-node">＋ 添加圆圈</button><button type="button" class="mini-button" data-action="recommend">重新推荐</button></div>`;
  } else if (state.stage === 2) {
    const node = state.nodes.find((item) => item.id === state.selectedNodeId);
    $('selectionPanel').innerHTML = describeNode(state.selectedNodeId);
    $('stepControls').innerHTML = `<div class="control-heading">片区边界</div><label class="field-label" for="districtRadius">${node ? escapeText(getNodeType(node.type).name) : '选中片区'}的影响范围 <strong id="districtRadiusValue">${node?.radius ?? 40}</strong></label><input id="districtRadius" class="range" type="range" min="28" max="88" step="1" value="${node?.radius ?? 40}" ${!node || node.locked ? 'disabled' : ''}><div class="control-card"><strong>边界会随节点调整</strong><p>点击片区、拖动小圆点或调整范围。虚线只表达规划关系，河流把陆上片区自然分开。</p></div>`;
  } else if (state.stage === 3) {
    $('selectionPanel').innerHTML = describeCorridor();
    $('stepControls').innerHTML = `<div class="control-card"><strong>${state.corridors.filter((item) => item.bridgeSegment).length} 条跨河联系 · ${state.lockedCorridors.length} 条已锁定</strong><p>重算只改变未锁定走廊的候选桥位；移动节点时，已锁定走线保留中间控制点。</p><button type="button" class="mini-button" data-action="regenerate">↻ 重新生成走线</button></div>`;
  } else {
    const segmentCount = makeStreetSegments(state.nodes, state.density).length;
    $('selectionPanel').innerHTML = `<div class="selection-label">本轮预览</div><div class="selection-title"><h3>${segmentCount} 段局部街线</h3><span class="type-pill">示意</span></div><p class="selection-copy">不同节点周围的街道方向略有变化；河道会遮挡水上街线，主通道仍保留候选桥位。</p><div class="note-list"><div class="note">可返回步骤 02 移动节点，街区道路会跟着更新。</div><div class="note warn">这是几何预览，不代表已经满足游戏里的道路坡度、交通容量或建筑分区要求。</div></div>`;
    $('stepControls').innerHTML = `<div class="control-heading">街区尺度</div><label class="field-label" for="densityRange">局部街道密度 <strong id="densityValue">${['', '疏', '中', '密'][state.density]}</strong></label><input id="densityRange" class="range" type="range" min="1" max="3" step="1" value="${state.density}"><div class="control-card"><strong>观察重点</strong><p>看主路与街区道路能否顺畅衔接，也留意公园、岸线和坡地有没有被细路切得太碎。</p></div>`;
  }
}

function render() {
  drawMap();
  drawInspector();
  persist();
}

function refreshCorridors() {
  state.corridors = generateCorridors(state.nodes, state.variant, state.corridors, state.lockedCorridors);
  state.lockedCorridors = state.lockedCorridors.filter((id) => state.corridors.some((corridor) => corridor.id === id));
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
    const x = Math.min(MAP_BOUNDS.maxX, 380 + (occupied * 77) % 455);
    const y = Math.min(MAP_BOUNDS.maxY, 210 + (occupied * 53) % 345);
    state.nodes = [...state.nodes, { id, type, x, y, radius: 40, locked: false }];
    state.selectedNodeId = id;
    refreshCorridors();
  } else if (action === 'recommend') {
    state.nodes = reflowSupplyNodes(makeDefaultNodes(), state.wind);
    state.selectedNodeId = 'cbd';
    state.lockedCorridors = [];
    state.variant = 0;
    state.corridors = generateCorridors(state.nodes);
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
  const payload = {
    schema: 'cs2-urban-planning-guide/prototype-2',
    map: 'River Delta — schematic, not extracted game data',
    exportedAt: new Date().toISOString(),
    nodes: state.nodes,
    districts: makeDistricts(state.nodes),
    corridors: state.corridors,
    streetDensity: state.density,
    planningBoundaryPercent: state.boundaryScale,
    assumedWindDirection: state.wind,
    shippingChannel: 'schematic north distributary; verify in game',
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'river-delta-planning-prototype.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

map.addEventListener('pointerdown', (event) => {
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
  if (dragging.kind === 'move') {
    state.nodes = moveNode(state.nodes, dragging.id, position.x + dragging.offsetX, position.y + dragging.offsetY);
  } else {
    const node = state.nodes.find((item) => item.id === dragging.id);
    state.nodes = resizeNode(state.nodes, dragging.id, Math.hypot(position.x - node.x, position.y - node.y) / .99);
  }
  refreshCorridors();
  drawMap();
  persist();
});

map.addEventListener('pointerup', (event) => {
  if (!dragging) return;
  dragging = null;
  if (map.hasPointerCapture(event.pointerId)) map.releasePointerCapture(event.pointerId);
  drawInspector();
  persist();
});
map.addEventListener('pointercancel', () => { dragging = null; render(); });

$('stageNav').addEventListener('click', (event) => {
  const button = event.target.closest('[data-stage]');
  if (!button) return;
  state.stage = Number(button.dataset.stage);
  render();
});
$('backButton').addEventListener('click', () => { state.stage = Math.max(0, state.stage - 1); render(); });
$('nextButton').addEventListener('click', () => { state.stage = Math.min(4, state.stage + 1); render(); });
$('resetButton').addEventListener('click', () => { state = freshState(); render(); });
$('canvasSizeButton').addEventListener('click', () => { focusMode = !focusMode; inspectorHidden = false; renderCanvasMode(); });
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
$('stepControls').addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]');
  if (action) handleAction(action.dataset.action);
});
$('stepControls').addEventListener('change', (event) => {
  if (event.target.id === 'nodeType') { state.addType = event.target.value; persist(); }
  if (event.target.id === 'districtRadius') render();
  if (event.target.id === 'windDirection') {
    state.wind = event.target.value;
    state.nodes = reflowSupplyNodes(state.nodes, state.wind);
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
