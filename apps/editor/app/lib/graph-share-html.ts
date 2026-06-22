import {
  EDGE_STATUS_LABELS,
  getNodeWeightTierLabel,
  NODE_TYPE_LABELS,
  RELATION_TYPE_LABELS,
} from './graph-labels';
import {
  EdgeStatus,
  GraphAuthoringDocument,
  GraphAuthoringNode,
  NodeWeightTier,
  RelationType,
  ResearchNodeType,
} from './graph-types';

interface ShareLane {
  id: string;
  label: string;
  color: string;
  order: number;
}

interface ShareNode {
  id: string;
  type: ResearchNodeType;
  typeLabel: string;
  label: string;
  weightTier: NodeWeightTier;
  weightLabel: string;
  lane: string;
  order: number;
  summary: string;
  ticker: string;
  market: string;
  searchText: string;
}

interface ShareEdge {
  id: string;
  sourceId: string;
  targetId: string;
  sourceLabel: string;
  targetLabel: string;
  relationType: RelationType;
  relationLabel: string;
  status: EdgeStatus;
  statusLabel: string;
  weight: number;
  note: string;
}

interface ShareRelationOption {
  value: RelationType;
  label: string;
}

interface ShareGraphData {
  schemaVersion: 1;
  generatedAt: string;
  graph: {
    label: string;
    summary: string;
  };
  lanes: ShareLane[];
  nodes: ShareNode[];
  edges: ShareEdge[];
  relationTypes: ShareRelationOption[];
}

/**
 * 转义 HTML 文本，避免图谱名称进入标题时破坏页面结构。
 * @param value 原始文本。
 * @returns 可安全写入 HTML 的文本。
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 转义 JSON 文本，避免内嵌数据提前结束 script 标签。
 * @param value JSON 字符串。
 * @returns 可安全写入 script[type="application/json"] 的 JSON 文本。
 */
function escapeJsonForHtml(value: string): string {
  return value
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * 生成节点默认引用文本，与可编辑 JSON 的导入导出规则保持一致。
 * @param node 可编辑图谱节点。
 * @returns 节点引用文本。
 */
function createDefaultNodeReference(node: Pick<GraphAuthoringNode, 'type' | 'label' | 'market' | 'ticker'>): string {
  if (node.type === 'company' && node.market && node.ticker) {
    return `${node.type}:${node.label}:${node.market}:${node.ticker}`;
  }
  return `${node.type}:${node.label}`;
}

/**
 * 添加节点引用索引。
 * @param node 分享节点。
 * @param nodeByReference 引用到节点 ID 的索引。
 * @param ambiguousReferences 有歧义的引用集合。
 */
function indexNodeReferences(
  node: ShareNode,
  nodeByReference: Map<string, string>,
  ambiguousReferences: Set<string>
): void {
  const references = [
    node.label,
    `${node.type}:${node.label}`,
    createDefaultNodeReference(node),
  ];

  for (const reference of references) {
    if (ambiguousReferences.has(reference)) {
      continue;
    }
    const existingNodeId = nodeByReference.get(reference);
    if (existingNodeId && existingNodeId !== node.id) {
      nodeByReference.delete(reference);
      ambiguousReferences.add(reference);
      continue;
    }
    nodeByReference.set(reference, node.id);
  }
}

/**
 * 读取节点权重，缺省时使用 medium。
 * @param weightTier 可编辑节点中的权重字段。
 * @returns 标准节点权重。
 */
function normalizeWeightTier(weightTier: NodeWeightTier | undefined): NodeWeightTier {
  return weightTier || 'medium';
}

/**
 * 构建静态分享页使用的扁平数据模型。
 * @param document 可编辑图谱文档。
 * @returns 可直接内嵌到单页 HTML 的图谱数据。
 */
function createShareGraphData(document: GraphAuthoringDocument): ShareGraphData {
  const lanes = document.lanes
    .map((lane, index) => ({
      id: `lane-${index + 1}`,
      label: lane.label,
      color: lane.color || '#2563eb',
      order: lane.order ?? (index + 1) * 10,
    }))
    .sort((leftLane, rightLane) => (
      leftLane.order - rightLane.order || leftLane.label.localeCompare(rightLane.label, 'zh-CN')
    ));

  const nodeByReference = new Map<string, string>();
  const ambiguousReferences = new Set<string>();
  const nodes = document.nodes.map((node, index) => {
    const weightTier = normalizeWeightTier(node.weightTier);
    const typeLabel = NODE_TYPE_LABELS[node.type];
    const weightLabel = getNodeWeightTierLabel(node.type, weightTier);
    const shareNode: ShareNode = {
      id: `node-${index + 1}`,
      type: node.type,
      typeLabel,
      label: node.label,
      weightTier,
      weightLabel,
      lane: node.lane || '',
      order: node.order ?? (index + 1) * 10,
      summary: node.summary || '',
      ticker: node.ticker || '',
      market: node.market || '',
      searchText: [
        node.label,
        node.summary || '',
        node.ticker || '',
        node.market || '',
        node.lane || '',
        typeLabel,
        weightLabel,
      ].join(' ').toLowerCase(),
    };
    indexNodeReferences(shareNode, nodeByReference, ambiguousReferences);
    return shareNode;
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const edges = document.edges.map((edge, index) => {
    const sourceId = nodeByReference.get(edge.from) || '';
    const targetId = nodeByReference.get(edge.to) || '';
    if (!sourceId || !targetId) {
      const ambiguousText = ambiguousReferences.has(edge.from) || ambiguousReferences.has(edge.to)
        ? '节点引用有歧义，请使用 type:label 或 company:label:market:ticker'
        : `关系节点不存在: ${edge.from} -> ${edge.to}`;
      throw new Error(`无法生成分享 HTML：${ambiguousText}`);
    }

    const sourceNode = nodeById.get(sourceId);
    const targetNode = nodeById.get(targetId);
    if (!sourceNode || !targetNode) {
      throw new Error(`无法生成分享 HTML：关系节点解析失败 ${edge.from} -> ${edge.to}`);
    }

    const status = edge.status || 'unverified';
    return {
      id: `edge-${index + 1}`,
      sourceId,
      targetId,
      sourceLabel: sourceNode.label,
      targetLabel: targetNode.label,
      relationType: edge.relationType,
      relationLabel: RELATION_TYPE_LABELS[edge.relationType],
      status,
      statusLabel: EDGE_STATUS_LABELS[status],
      weight: edge.weight ?? 1,
      note: edge.note || '',
    };
  });

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    graph: {
      label: document.graph.label,
      summary: document.graph.summary || '',
    },
    lanes,
    nodes,
    edges,
    relationTypes: Object.entries(RELATION_TYPE_LABELS).map(([value, label]) => ({
      value: value as RelationType,
      label,
    })),
  };
}

/**
 * 生成完整静态 HTML 页面。
 * @param document 可编辑图谱文档。
 * @returns 可离线打开的单文件 HTML。
 */
export function generateShareGraphHtml(document: GraphAuthoringDocument): string {
  const shareData = createShareGraphData(document);
  const escapedData = escapeJsonForHtml(JSON.stringify(shareData));
  const escapedTitle = escapeHtml(`${shareData.graph.label} - 产业图谱`);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapedTitle}</title>
  <style>
    :root {
      --background: #f7f8fb;
      --panel: #ffffff;
      --panel-soft: #f8fafc;
      --border: #d8e1eb;
      --border-strong: #b7c4d4;
      --text: #172033;
      --muted: #64748b;
      --primary: #2563eb;
      --green: #0f766e;
      --amber: #d97706;
      --red: #dc2626;
      --shadow: 0 16px 36px rgba(15, 23, 42, 0.08);
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      min-height: 100%;
      margin: 0;
      color: var(--text);
      background: var(--background);
      font-family: Arial, "Microsoft YaHei", "PingFang SC", sans-serif;
      overflow: hidden;
    }

    button,
    input,
    select {
      font: inherit;
    }

    button {
      border: 0;
    }

    .shareShell {
      min-height: 100vh;
      padding: 12px;
      background:
        linear-gradient(180deg, rgba(219, 234, 254, 0.5), rgba(247, 248, 251, 0) 260px),
        var(--background);
    }

    .topBar {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-end;
      max-width: 1800px;
      margin: 0 auto 10px;
    }

    .eyebrow {
      margin: 0 0 5px;
      color: var(--primary);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      font-size: 25px;
      letter-spacing: 0;
      overflow-wrap: anywhere;
    }

    .graphSummary {
      max-width: 860px;
      margin: 7px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.6;
      overflow-wrap: anywhere;
    }

    .stats {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
      color: var(--muted);
      font-size: 13px;
    }

    .stats span {
      display: inline-flex;
      align-items: center;
      min-height: 34px;
      padding: 0 10px;
      border: 1px solid rgba(255, 255, 255, 0.86);
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.76);
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.06);
    }

    .toolbar {
      display: grid;
      grid-template-columns: minmax(220px, 1.1fr) minmax(210px, 0.8fr) minmax(160px, 0.55fr) auto;
      gap: 10px;
      max-width: 1800px;
      margin: 0 auto 10px;
      padding: 9px;
      border: 1px solid rgba(255, 255, 255, 0.78);
      border-radius: 9px;
      background: rgba(255, 255, 255, 0.74);
      backdrop-filter: blur(14px) saturate(1.15);
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
    }

    .searchBox {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      padding: 0 10px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: #ffffff;
    }

    .searchBox input {
      width: 100%;
      min-height: 38px;
      min-width: 0;
      border: 0;
      outline: none;
      color: var(--text);
      background: transparent;
    }

    .segmentedControl,
    .zoomControls {
      display: flex;
      gap: 6px;
      min-width: 0;
    }

    .segmentedControl button,
    .zoomControls button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 38px;
      padding: 0 11px;
      color: #334155;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: #ffffff;
      cursor: pointer;
      white-space: nowrap;
    }

    .segmentedControl button.active {
      color: #ffffff;
      border-color: var(--primary);
      background: var(--primary);
      font-weight: 700;
    }

    .toolbar select {
      min-height: 38px;
      width: 100%;
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 7px;
      background: #ffffff;
      padding: 0 10px;
      outline: none;
    }

    .appGrid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 330px;
      gap: 12px;
      max-width: 1800px;
      margin: 0 auto;
      align-items: stretch;
    }

    .canvasPanel,
    .detailPanel {
      min-width: 0;
      border: 1px solid rgba(255, 255, 255, 0.78);
      border-radius: 9px;
      background: rgba(255, 255, 255, 0.82);
      box-shadow: 0 18px 42px rgba(15, 23, 42, 0.07);
      overflow: hidden;
    }

    .canvasPanel {
      position: relative;
      min-height: calc(100vh - 162px);
    }

    .detailPanel {
      max-height: calc(100vh - 162px);
      overflow-y: auto;
      padding: 14px;
    }

    .graphSvg {
      display: block;
      width: 100%;
      height: calc(100vh - 162px);
      min-height: 620px;
      background:
        linear-gradient(180deg, rgba(226, 232, 240, 0.48) 1px, transparent 1px) 0 0 / 100% 132px,
        #f8fbff;
      touch-action: none;
      cursor: grab;
    }

    .graphSvg.panning {
      cursor: grabbing;
    }

    .emptyState {
      position: absolute;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      color: var(--muted);
      font-size: 14px;
      pointer-events: none;
    }

    .laneBand {
      fill: rgba(255, 255, 255, 0.54);
      stroke: rgba(214, 225, 237, 0.78);
      stroke-width: 1;
    }

    .laneAccent {
      rx: 2;
    }

    .laneTitle {
      font-size: 12px;
      font-weight: 700;
    }

    .laneGuide {
      stroke-width: 2.6;
      opacity: 0.88;
    }

    .edgePath {
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
      opacity: 0.72;
      cursor: pointer;
      transition: opacity 0.16s ease, stroke-width 0.16s ease;
    }

    .edgeGlow {
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
      opacity: 0.1;
      pointer-events: none;
      filter: blur(0.8px);
    }

    .edgePath.selected {
      opacity: 1;
      stroke-width: 4.4;
    }

    .edgePath.related {
      opacity: 0.95;
      stroke-width: 3.8;
    }

    .edgePath.dimmed {
      opacity: 0.14;
    }

    .edgePath.status-unverified,
    .edgeGlow.status-unverified {
      stroke-dasharray: 9 7;
    }

    .edgePath.status-research {
      stroke-dasharray: 16 10;
    }

    .edgeGlow.dimmed {
      opacity: 0.02;
    }

    .edgeGlow.selected,
    .edgeGlow.related {
      opacity: 0.18;
    }

    .edgeLabel {
      fill: #334155;
      font-size: 10px;
      font-weight: 700;
      paint-order: stroke;
      stroke: rgba(255, 255, 255, 0.9);
      stroke-width: 4px;
      stroke-linejoin: round;
      cursor: pointer;
      pointer-events: auto;
      opacity: 0.78;
    }

    .edgeLabel.dimmed {
      opacity: 0.18;
    }

    .graphNode {
      cursor: pointer;
      transition: opacity 0.16s ease;
    }

    .graphNode.dimmed {
      opacity: 0.28;
    }

    .nodeDot {
      stroke: rgba(255, 255, 255, 0.96);
      stroke-width: 1.3;
      filter: url(#nodeShadow);
    }

    .graphNode.selected .nodeDot {
      stroke: #0f172a;
      stroke-width: 2.4;
    }

    .graphNode.related .nodeDot {
      stroke: #38bdf8;
      stroke-width: 2;
    }

    .nodeLabelBox {
      fill: rgba(255, 255, 255, 0.94);
      stroke: rgba(203, 213, 225, 0.92);
      stroke-width: 1;
      rx: 8;
      filter: url(#labelShadow);
    }

    .nodeLabel {
      fill: #172033;
      font-size: 11px;
      font-weight: 700;
      text-anchor: middle;
    }

    .nodeSubtitle {
      fill: #64748b;
      font-size: 10px;
      text-anchor: middle;
    }

    .detailPanel h2,
    .detailPanel h3 {
      margin: 0;
      letter-spacing: 0;
    }

    .detailPanel h2 {
      font-size: 17px;
      overflow-wrap: anywhere;
    }

    .detailPanel h3 {
      margin-top: 16px;
      font-size: 14px;
    }

    .detailMuted {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .infoGrid {
      display: grid;
      gap: 8px;
      margin-top: 12px;
    }

    .infoRow {
      display: grid;
      gap: 3px;
      padding: 8px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--panel-soft);
    }

    .infoRow span {
      color: var(--muted);
      font-size: 12px;
    }

    .infoRow strong {
      font-size: 13px;
      font-weight: 600;
      line-height: 1.5;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }

    .relationList,
    .legendList {
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }

    .relationButton {
      display: grid;
      gap: 4px;
      width: 100%;
      padding: 9px;
      text-align: left;
      color: var(--text);
      border: 1px solid var(--border);
      border-left: 4px solid var(--border-strong);
      border-radius: 8px;
      background: #ffffff;
      cursor: pointer;
    }

    .relationButton.status-fact {
      border-left-color: var(--green);
    }

    .relationButton.status-research {
      border-left-color: var(--primary);
    }

    .relationButton.status-unverified {
      border-left-color: var(--amber);
    }

    .relationButton span {
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .legendItem {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #334155;
      font-size: 13px;
    }

    .legendSwatch {
      width: 13px;
      height: 13px;
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.8);
      box-shadow: 0 2px 5px rgba(15, 23, 42, 0.1);
      flex: 0 0 auto;
    }

    @media (max-width: 1100px) {
      .toolbar,
      .appGrid {
        grid-template-columns: 1fr;
      }

      .detailPanel {
        max-height: none;
      }
    }

    @media (max-width: 680px) {
      .shareShell {
        padding: 10px;
      }

      .topBar {
        align-items: flex-start;
        flex-direction: column;
      }

      .stats {
        justify-content: flex-start;
      }

      h1 {
        font-size: 22px;
      }

      .toolbar {
        gap: 8px;
      }

      .segmentedControl,
      .zoomControls {
        flex-wrap: wrap;
      }

      .graphSvg {
        min-height: 560px;
        height: 560px;
      }

      body {
        overflow: auto;
      }
    }
  </style>
</head>
<body>
  <div class="shareShell">
    <header class="topBar">
      <div>
        <p class="eyebrow">Research Graph Share</p>
        <h1 id="graphTitle"></h1>
        <p id="graphSummary" class="graphSummary"></p>
      </div>
      <div id="stats" class="stats"></div>
    </header>

    <section class="toolbar">
      <label class="searchBox">
        <span>搜索</span>
        <input id="searchInput" type="search" placeholder="概念、公司、代码">
      </label>
      <div class="segmentedControl" aria-label="视图">
        <button class="active" type="button" data-mode="industry">产业链</button>
        <button type="button" data-mode="company">公司关系</button>
      </div>
      <select id="relationFilter" aria-label="关系筛选"></select>
      <div class="zoomControls">
        <button id="zoomOutButton" type="button">-</button>
        <button id="fitButton" type="button">适配</button>
        <button id="zoomInButton" type="button">+</button>
      </div>
    </section>

    <main class="appGrid">
      <section class="canvasPanel">
        <svg id="graphSvg" class="graphSvg" role="img" aria-label="产业图谱">
          <defs>
            <marker id="arrowMarker" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"></path>
            </marker>
            <filter id="nodeShadow" x="-60%" y="-60%" width="220%" height="220%">
              <feDropShadow dx="0" dy="7" stdDeviation="5" flood-color="#0f172a" flood-opacity="0.18"></feDropShadow>
            </filter>
            <filter id="labelShadow" x="-30%" y="-50%" width="160%" height="210%">
              <feDropShadow dx="0" dy="7" stdDeviation="5" flood-color="#0f172a" flood-opacity="0.1"></feDropShadow>
            </filter>
            <radialGradient id="nodeGradient-narrative" cx="32%" cy="24%" r="72%">
              <stop offset="0%" stop-color="#fde68a"></stop>
              <stop offset="48%" stop-color="#f59e0b"></stop>
              <stop offset="100%" stop-color="#b45309"></stop>
            </radialGradient>
            <radialGradient id="nodeGradient-industry" cx="32%" cy="24%" r="72%">
              <stop offset="0%" stop-color="#86efac"></stop>
              <stop offset="48%" stop-color="#16a34a"></stop>
              <stop offset="100%" stop-color="#15803d"></stop>
            </radialGradient>
            <radialGradient id="nodeGradient-concept" cx="32%" cy="24%" r="72%">
              <stop offset="0%" stop-color="#93c5fd"></stop>
              <stop offset="50%" stop-color="#2563eb"></stop>
              <stop offset="100%" stop-color="#1d4ed8"></stop>
            </radialGradient>
            <radialGradient id="nodeGradient-product" cx="32%" cy="24%" r="72%">
              <stop offset="0%" stop-color="#c4b5fd"></stop>
              <stop offset="50%" stop-color="#7c3aed"></stop>
              <stop offset="100%" stop-color="#5b21b6"></stop>
            </radialGradient>
            <radialGradient id="nodeGradient-material" cx="32%" cy="24%" r="72%">
              <stop offset="0%" stop-color="#fdba74"></stop>
              <stop offset="48%" stop-color="#ea580c"></stop>
              <stop offset="100%" stop-color="#c2410c"></stop>
            </radialGradient>
            <radialGradient id="nodeGradient-process" cx="32%" cy="24%" r="72%">
              <stop offset="0%" stop-color="#67e8f9"></stop>
              <stop offset="50%" stop-color="#0891b2"></stop>
              <stop offset="100%" stop-color="#0e7490"></stop>
            </radialGradient>
            <radialGradient id="nodeGradient-company" cx="32%" cy="24%" r="72%">
              <stop offset="0%" stop-color="#5eead4"></stop>
              <stop offset="48%" stop-color="#0f766e"></stop>
              <stop offset="100%" stop-color="#115e59"></stop>
            </radialGradient>
          </defs>
          <g id="viewport"></g>
        </svg>
        <div id="emptyState" class="emptyState">当前筛选没有匹配节点</div>
      </section>
      <aside class="detailPanel">
        <div id="detailContent"></div>
      </aside>
    </main>
  </div>

  <script id="graph-data" type="application/json">${escapedData}</script>
  <script>
    (function () {
      var data = JSON.parse(document.getElementById('graph-data').textContent || '{}');
      var state = {
        mode: 'industry',
        searchText: '',
        relationFilter: 'all',
        selectedNodeId: '',
        selectedEdgeId: '',
        scale: 1,
        x: 0,
        y: 0,
        isPanning: false,
        lastPointerX: 0,
        lastPointerY: 0,
        layout: null,
        visibleEdges: [],
        visibleNodes: []
      };
      var svg = document.getElementById('graphSvg');
      var viewport = document.getElementById('viewport');
      var emptyState = document.getElementById('emptyState');
      var detailContent = document.getElementById('detailContent');
      var nodeById = new Map(data.nodes.map(function (node) { return [node.id, node]; }));
      var edgeById = new Map(data.edges.map(function (edge) { return [edge.id, edge]; }));
      var laneByLabel = new Map(data.lanes.map(function (lane) { return [lane.label, lane]; }));
      var nodeColorByType = {
        narrative: '#f59e0b',
        industry: '#16a34a',
        concept: '#2563eb',
        product: '#7c3aed',
        material: '#ea580c',
        process: '#0891b2',
        company: '#0f766e'
      };
      var statusColorByType = {
        fact: '#0f766e',
        research: '#6366f1',
        unverified: '#7c3aed'
      };
      var radiusByWeight = {
        high: 31,
        medium: 24,
        low: 17
      };

      function createSvgElement(tagName, attributes) {
        var element = document.createElementNS('http://www.w3.org/2000/svg', tagName);
        Object.keys(attributes || {}).forEach(function (key) {
          element.setAttribute(key, String(attributes[key]));
        });
        return element;
      }

      function createElement(tagName, className, text) {
        var element = document.createElement(tagName);
        if (className) {
          element.className = className;
        }
        if (typeof text === 'string') {
          element.textContent = text;
        }
        return element;
      }

      function clearElement(element) {
        while (element.firstChild) {
          element.removeChild(element.firstChild);
        }
      }

      function compareNodes(leftNode, rightNode) {
        return leftNode.order - rightNode.order
          || leftNode.type.localeCompare(rightNode.type)
          || leftNode.label.localeCompare(rightNode.label, 'zh-CN');
      }

      function nodeBelongsToMode(node) {
        if (state.mode === 'company') {
          return node.type === 'company';
        }
        return true;
      }

      function edgeBelongsToMode(edge) {
        var sourceNode = nodeById.get(edge.sourceId);
        var targetNode = nodeById.get(edge.targetId);
        if (!sourceNode || !targetNode) {
          return false;
        }
        if (state.mode === 'company') {
          return sourceNode.type === 'company' && targetNode.type === 'company';
        }
        return !(sourceNode.type === 'company' && targetNode.type === 'company');
      }

      function nodeMatchesSearch(node) {
        var query = state.searchText.trim().toLowerCase();
        if (!query) {
          return true;
        }
        return node.searchText.indexOf(query) >= 0;
      }

      function getVisibleModel() {
        var viewNodes = data.nodes.filter(nodeBelongsToMode);
        var relationFilteredEdges = data.edges.filter(function (edge) {
          return edgeBelongsToMode(edge)
            && (state.relationFilter === 'all' || edge.relationType === state.relationFilter);
        });
        var matchedNodeIds = new Set(viewNodes.filter(nodeMatchesSearch).map(function (node) { return node.id; }));
        var visibleNodeIds = new Set(matchedNodeIds);
        if (state.searchText.trim()) {
          relationFilteredEdges.forEach(function (edge) {
            if (matchedNodeIds.has(edge.sourceId) || matchedNodeIds.has(edge.targetId)) {
              visibleNodeIds.add(edge.sourceId);
              visibleNodeIds.add(edge.targetId);
            }
          });
        }
        var visibleNodes = viewNodes.filter(function (node) { return visibleNodeIds.has(node.id); });
        var visibleNodeIdSet = new Set(visibleNodes.map(function (node) { return node.id; }));
        var visibleEdges = relationFilteredEdges.filter(function (edge) {
          return visibleNodeIdSet.has(edge.sourceId) && visibleNodeIdSet.has(edge.targetId);
        });
        return {
          nodes: visibleNodes,
          edges: visibleEdges
        };
      }

      function getLaneGroups(nodes) {
        if (state.mode === 'company') {
          return [{
            id: 'company-lane',
            label: '公司关系',
            color: '#0f766e',
            order: 0,
            nodes: nodes.slice().sort(compareNodes)
          }];
        }

        var nodeGroupsByLane = new Map();
        nodes.forEach(function (node) {
          var laneLabel = node.lane || (node.type === 'company' ? '关联公司' : '主题节点');
          if (!nodeGroupsByLane.has(laneLabel)) {
            nodeGroupsByLane.set(laneLabel, []);
          }
          nodeGroupsByLane.get(laneLabel).push(node);
        });

        var groups = data.lanes.map(function (lane) {
          return {
            id: lane.id,
            label: lane.label,
            color: lane.color,
            order: lane.order,
            nodes: (nodeGroupsByLane.get(lane.label) || []).slice().sort(compareNodes)
          };
        });
        ['主题节点', '关联公司'].forEach(function (laneLabel, index) {
          var groupedNodes = nodeGroupsByLane.get(laneLabel) || [];
          if (groupedNodes.length > 0 && !laneByLabel.has(laneLabel)) {
            groups.push({
              id: 'virtual-' + index,
              label: laneLabel,
              color: index === 0 ? '#f59e0b' : '#0f766e',
              order: index === 0 ? -20 : 100000,
              nodes: groupedNodes.slice().sort(compareNodes)
            });
          }
        });
        nodeGroupsByLane.forEach(function (groupedNodes, laneLabel) {
          if (laneByLabel.has(laneLabel) || laneLabel === '主题节点' || laneLabel === '关联公司') {
            return;
          }
          groups.push({
            id: 'virtual-extra-' + groups.length,
            label: laneLabel,
            color: '#64748b',
            order: 90000 + groups.length,
            nodes: groupedNodes.slice().sort(compareNodes)
          });
        });
        return groups
          .filter(function (group) { return group.nodes.length > 0; })
          .sort(function (leftGroup, rightGroup) {
            return leftGroup.order - rightGroup.order || leftGroup.label.localeCompare(rightGroup.label, 'zh-CN');
          });
      }

      function getTextLength(text) {
        return Array.from(text || '').reduce(function (total, character) {
          return total + (character.charCodeAt(0) > 255 ? 1 : 0.58);
        }, 0);
      }

      function getLabelBoxWidth(node) {
        var titleWidth = getTextLength(node.label) * 12 + 28;
        var subtitleText = node.ticker ? node.market + ' ' + node.ticker : node.typeLabel + ' / ' + node.weightLabel;
        var subtitleWidth = getTextLength(subtitleText) * 9 + 24;
        return Math.max(96, Math.min(146, Math.max(titleWidth, subtitleWidth)));
      }

      function buildLayout(nodes) {
        var svgWidth = Math.max(980, svg.clientWidth || 980);
        var margin = 24;
        var headerWidth = 116;
        var cellWidth = 136;
        var rowHeight = 108;
        var availableWidth = Math.max(360, svgWidth - margin * 2 - headerWidth - 34);
        var columns = Math.max(2, Math.floor(availableWidth / cellWidth));
        var y = margin;
        var positions = new Map();
        var lanes = getLaneGroups(nodes).map(function (group) {
          var rowCount = Math.max(1, Math.ceil(group.nodes.length / columns));
          var laneHeight = group.nodes.length > 0 ? 72 + rowCount * rowHeight : 90;
          group.nodes.forEach(function (node, index) {
            var columnIndex = index % columns;
            var rowIndex = Math.floor(index / columns);
            var rowStartIndex = rowIndex * columns;
            var rowNodeCount = Math.min(columns, group.nodes.length - rowStartIndex);
            var centeredOffsetX = (columns - rowNodeCount) * cellWidth / 2;
            positions.set(node.id, {
              x: margin + headerWidth + centeredOffsetX + columnIndex * cellWidth + cellWidth / 2,
              y: y + 64 + rowIndex * rowHeight,
              r: radiusByWeight[node.weightTier] || radiusByWeight.medium,
              labelWidth: getLabelBoxWidth(node)
            });
          });
          var lane = {
            id: group.id,
            label: group.label,
            color: group.color,
            x: margin,
            y: y,
            width: Math.max(svgWidth - margin * 2, headerWidth + columns * cellWidth + 34),
            height: laneHeight,
            nodes: group.nodes
          };
          y += laneHeight + 18;
          return lane;
        });
        return {
          lanes: lanes,
          positions: positions,
          bounds: {
            x: 0,
            y: 0,
            width: Math.max(svgWidth, lanes.reduce(function (maxWidth, lane) { return Math.max(maxWidth, lane.width + margin); }, svgWidth)),
            height: Math.max(420, y + margin)
          }
        };
      }

      function getActiveNodeIds(edges) {
        var activeNodeIds = new Set();
        if (state.selectedNodeId) {
          activeNodeIds.add(state.selectedNodeId);
          edges.forEach(function (edge) {
            if (edge.sourceId === state.selectedNodeId) {
              activeNodeIds.add(edge.targetId);
            }
            if (edge.targetId === state.selectedNodeId) {
              activeNodeIds.add(edge.sourceId);
            }
          });
        }
        if (state.selectedEdgeId) {
          var selectedEdge = edgeById.get(state.selectedEdgeId);
          if (selectedEdge) {
            activeNodeIds.add(selectedEdge.sourceId);
            activeNodeIds.add(selectedEdge.targetId);
          }
        }
        return activeNodeIds;
      }

      function getEdgeClassName(edge, activeNodeIds) {
        var classes = ['edgePath', 'status-' + edge.status];
        var hasSelection = Boolean(state.selectedNodeId || state.selectedEdgeId);
        var isRelated = state.selectedNodeId
          ? edge.sourceId === state.selectedNodeId || edge.targetId === state.selectedNodeId
          : activeNodeIds.has(edge.sourceId) && activeNodeIds.has(edge.targetId);
        if (edge.id === state.selectedEdgeId) {
          classes.push('selected');
        } else if (isRelated) {
          classes.push('related');
        } else if (hasSelection) {
          classes.push('dimmed');
        }
        return classes.join(' ');
      }

      function getNodeClassName(node, activeNodeIds) {
        var classes = ['graphNode', 'type-' + node.type];
        var hasSelection = Boolean(state.selectedNodeId || state.selectedEdgeId);
        if (node.id === state.selectedNodeId) {
          classes.push('selected');
        } else if (activeNodeIds.has(node.id)) {
          classes.push('related');
        } else if (hasSelection) {
          classes.push('dimmed');
        }
        return classes.join(' ');
      }

      function splitLabel(label) {
        var maxChars = 8;
        var text = label || '';
        if (text.length <= maxChars) {
          return [text];
        }
        var firstLine = text.slice(0, maxChars);
        var secondLine = text.slice(maxChars, maxChars * 2);
        if (text.length > maxChars * 2) {
          secondLine = secondLine.slice(0, Math.max(0, maxChars - 1)) + '...';
        }
        return [firstLine, secondLine];
      }

      function getBoundaryPoint(fromPosition, toPosition, radiusOffset) {
        var dx = toPosition.x - fromPosition.x;
        var dy = toPosition.y - fromPosition.y;
        var distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        return {
          x: fromPosition.x + dx / distance * radiusOffset,
          y: fromPosition.y + dy / distance * radiusOffset
        };
      }

      function createEdgePath(sourcePosition, targetPosition) {
        var sourcePoint = getBoundaryPoint(sourcePosition, targetPosition, sourcePosition.r + 3);
        var targetPoint = getBoundaryPoint(targetPosition, sourcePosition, targetPosition.r + 7);
        var sourceX = sourcePoint.x;
        var sourceY = sourcePoint.y;
        var targetX = targetPoint.x;
        var targetY = targetPoint.y;
        var offset = Math.max(46, Math.min(176, Math.abs(targetX - sourceX) * 0.38 + Math.abs(targetY - sourceY) * 0.12));
        var sourceControlX = sourceX <= targetX ? sourceX + offset : sourceX - offset;
        var targetControlX = sourceX <= targetX ? targetX - offset : targetX + offset;
        return 'M ' + sourceX + ' ' + sourceY
          + ' C ' + sourceControlX + ' ' + sourceY
          + ', ' + targetControlX + ' ' + targetY
          + ', ' + targetX + ' ' + targetY;
      }

      function renderLanes(layout) {
        layout.lanes.forEach(function (lane) {
          var group = createSvgElement('g', {});
          var rect = createSvgElement('rect', {
            class: 'laneBand',
            x: lane.x,
            y: lane.y,
            width: lane.width,
            height: lane.height,
            rx: 0
          });
          var accent = createSvgElement('rect', {
            class: 'laneAccent',
            x: lane.x + 10,
            y: lane.y,
            width: 4,
            height: lane.height,
            fill: lane.color
          });
          var guide = createSvgElement('line', {
            class: 'laneGuide',
            x1: lane.x + 10,
            y1: lane.y,
            x2: lane.x + 10,
            y2: lane.y + lane.height,
            stroke: lane.color
          });
          var title = createSvgElement('text', {
            class: 'laneTitle',
            x: lane.x + 22,
            y: lane.y + 28,
            fill: lane.color
          });
          title.textContent = lane.label;
          group.appendChild(rect);
          group.appendChild(accent);
          group.appendChild(guide);
          group.appendChild(title);
          viewport.appendChild(group);
        });
      }

      function renderEdges(edges, layout, activeNodeIds) {
        edges.forEach(function (edge) {
          var sourcePosition = layout.positions.get(edge.sourceId);
          var targetPosition = layout.positions.get(edge.targetId);
          if (!sourcePosition || !targetPosition) {
            return;
          }
          var pathData = createEdgePath(sourcePosition, targetPosition);
          var edgeClassName = getEdgeClassName(edge, activeNodeIds);
          var strokeColor = statusColorByType[edge.status] || '#64748b';
          var strokeWidth = Math.max(2, Math.min(3.8, 1.8 + Number(edge.weight || 1) * 0.36));
          var glow = createSvgElement('path', {
            class: edgeClassName.replace('edgePath', 'edgeGlow'),
            d: pathData,
            stroke: strokeColor,
            'stroke-width': String(strokeWidth + 4),
            'data-edge-id': edge.id
          });
          var path = createSvgElement('path', {
            class: edgeClassName,
            d: pathData,
            stroke: strokeColor,
            'stroke-width': String(strokeWidth),
            'marker-end': 'url(#arrowMarker)',
            'data-edge-id': edge.id
          });
          path.addEventListener('click', function (event) {
            event.stopPropagation();
            state.selectedEdgeId = edge.id;
            state.selectedNodeId = '';
            render(false);
          });
          var label = createSvgElement('text', {
            class: edgeClassName.replace('edgePath', 'edgeLabel'),
            x: (sourcePosition.x + targetPosition.x) / 2,
            y: (sourcePosition.y + targetPosition.y) / 2 - 8,
            'data-edge-id': edge.id
          });
          label.textContent = edge.relationLabel;
          label.addEventListener('click', function (event) {
            event.stopPropagation();
            state.selectedEdgeId = edge.id;
            state.selectedNodeId = '';
            render(false);
          });
          viewport.appendChild(glow);
          viewport.appendChild(path);
          viewport.appendChild(label);
        });
      }

      function renderNodes(nodes, layout, activeNodeIds) {
        nodes.forEach(function (node) {
          var position = layout.positions.get(node.id);
          if (!position) {
            return;
          }
          var group = createSvgElement('g', {
            class: getNodeClassName(node, activeNodeIds),
            transform: 'translate(' + position.x + ',' + position.y + ')',
            'data-node-id': node.id
          });
          var title = createSvgElement('title', {});
          title.textContent = node.label;
          var titleLines = splitLabel(node.label);
          var labelWidth = position.labelWidth || 118;
          var labelHeight = titleLines.length > 1 ? 50 : 42;
          var labelTop = position.r + 12;
          var titleStartY = labelTop + 17;
          var circle = createSvgElement('circle', {
            class: 'nodeDot',
            r: position.r,
            fill: 'url(#nodeGradient-' + node.type + ')'
          });
          var labelBox = createSvgElement('rect', {
            class: 'nodeLabelBox',
            x: -labelWidth / 2,
            y: labelTop,
            width: labelWidth,
            height: labelHeight
          });
          var text = createSvgElement('text', {
            class: 'nodeLabel',
            x: 0,
            y: titleStartY
          });
          titleLines.forEach(function (line, index) {
            var tspan = createSvgElement('tspan', {
              x: 0,
              dy: index === 0 ? 0 : 14
            });
            tspan.textContent = line;
            text.appendChild(tspan);
          });
          var subtitle = createSvgElement('text', {
            class: 'nodeSubtitle',
            x: 0,
            y: labelTop + labelHeight - 9
          });
          subtitle.textContent = node.ticker ? node.market + ' ' + node.ticker : node.typeLabel + ' / ' + node.weightLabel;
          group.appendChild(title);
          group.appendChild(circle);
          group.appendChild(labelBox);
          group.appendChild(text);
          group.appendChild(subtitle);
          group.addEventListener('click', function (event) {
            event.stopPropagation();
            state.selectedNodeId = node.id;
            state.selectedEdgeId = '';
            render(false);
          });
          viewport.appendChild(group);
        });
      }

      function renderSvg(model) {
        clearElement(viewport);
        var layout = buildLayout(model.nodes);
        var activeNodeIds = getActiveNodeIds(model.edges);
        state.layout = layout;
        state.visibleEdges = model.edges;
        state.visibleNodes = model.nodes;
        svg.setAttribute('viewBox', '0 0 ' + Math.max(1, svg.clientWidth || 980) + ' ' + Math.max(1, svg.clientHeight || 620));
        emptyState.style.display = model.nodes.length === 0 ? 'flex' : 'none';
        renderLanes(layout);
        renderEdges(model.edges, layout, activeNodeIds);
        renderNodes(model.nodes, layout, activeNodeIds);
      }

      function appendInfoRow(container, label, value) {
        if (!value && value !== 0) {
          return;
        }
        var row = createElement('div', 'infoRow');
        row.appendChild(createElement('span', '', label));
        row.appendChild(createElement('strong', '', String(value)));
        container.appendChild(row);
      }

      function getVisibleRelatedEdges(nodeId) {
        return state.visibleEdges.filter(function (edge) {
          return edge.sourceId === nodeId || edge.targetId === nodeId;
        });
      }

      function renderRelationList(container, edges) {
        if (edges.length === 0) {
          container.appendChild(createElement('p', 'detailMuted', '当前视图没有直接关系'));
          return;
        }
        var list = createElement('div', 'relationList');
        edges.forEach(function (edge) {
          var button = createElement('button', 'relationButton status-' + edge.status);
          button.type = 'button';
          button.appendChild(createElement('strong', '', edge.sourceLabel + ' -> ' + edge.targetLabel));
          button.appendChild(createElement('span', '', edge.relationLabel + ' / ' + edge.statusLabel));
          if (edge.note) {
            button.appendChild(createElement('span', '', edge.note));
          }
          button.addEventListener('click', function () {
            state.selectedEdgeId = edge.id;
            state.selectedNodeId = '';
            render(false);
          });
          list.appendChild(button);
        });
        container.appendChild(list);
      }

      function renderGraphDetail() {
        detailContent.appendChild(createElement('h2', '', data.graph.label));
        detailContent.appendChild(createElement('p', 'detailMuted', data.graph.summary || ''));
        var grid = createElement('div', 'infoGrid');
        appendInfoRow(grid, '节点数量', data.nodes.length);
        appendInfoRow(grid, '关系数量', data.edges.length);
        appendInfoRow(grid, '泳道数量', data.lanes.length);
        appendInfoRow(grid, '生成时间', data.generatedAt);
        detailContent.appendChild(grid);
        if (data.lanes.length > 0) {
          detailContent.appendChild(createElement('h3', '', '泳道'));
          var legend = createElement('div', 'legendList');
          data.lanes.forEach(function (lane) {
            var item = createElement('div', 'legendItem');
            var swatch = createElement('span', 'legendSwatch');
            swatch.style.background = lane.color;
            item.appendChild(swatch);
            item.appendChild(createElement('span', '', lane.label));
            legend.appendChild(item);
          });
          detailContent.appendChild(legend);
        }
      }

      function renderNodeDetail(node) {
        detailContent.appendChild(createElement('h2', '', node.label));
        detailContent.appendChild(createElement('p', 'detailMuted', node.typeLabel + ' / ' + node.weightLabel));
        var grid = createElement('div', 'infoGrid');
        appendInfoRow(grid, '节点类型', node.typeLabel);
        appendInfoRow(grid, '权重', node.weightLabel);
        appendInfoRow(grid, '泳道', node.lane);
        appendInfoRow(grid, '市场', node.market);
        appendInfoRow(grid, '代码', node.ticker);
        appendInfoRow(grid, '说明', node.summary);
        detailContent.appendChild(grid);
        detailContent.appendChild(createElement('h3', '', '直接关系'));
        renderRelationList(detailContent, getVisibleRelatedEdges(node.id));
      }

      function renderEdgeDetail(edge) {
        detailContent.appendChild(createElement('h2', '', edge.sourceLabel + ' -> ' + edge.targetLabel));
        detailContent.appendChild(createElement('p', 'detailMuted', edge.relationLabel + ' / ' + edge.statusLabel));
        var grid = createElement('div', 'infoGrid');
        appendInfoRow(grid, '来源节点', edge.sourceLabel);
        appendInfoRow(grid, '目标节点', edge.targetLabel);
        appendInfoRow(grid, '关系类型', edge.relationLabel);
        appendInfoRow(grid, '关系状态', edge.statusLabel);
        appendInfoRow(grid, '关系权重', edge.weight);
        appendInfoRow(grid, '备注', edge.note);
        detailContent.appendChild(grid);
      }

      function renderDetail() {
        clearElement(detailContent);
        if (state.selectedNodeId && nodeById.has(state.selectedNodeId)) {
          renderNodeDetail(nodeById.get(state.selectedNodeId));
          return;
        }
        if (state.selectedEdgeId && edgeById.has(state.selectedEdgeId)) {
          renderEdgeDetail(edgeById.get(state.selectedEdgeId));
          return;
        }
        renderGraphDetail();
      }

      function updateTransform() {
        viewport.setAttribute('transform', 'translate(' + state.x + ',' + state.y + ') scale(' + state.scale + ')');
      }

      function fitView() {
        if (!state.layout) {
          return;
        }
        var bounds = state.layout.bounds;
        var width = svg.clientWidth || 980;
        var height = svg.clientHeight || 620;
        var scaleX = (width - 56) / Math.max(1, bounds.width);
        var scaleY = (height - 56) / Math.max(1, bounds.height);
        var preferredScale = bounds.height > height * 1.12
          ? scaleX
          : Math.min(scaleX, scaleY);
        state.scale = Math.max(0.62, Math.min(1.18, preferredScale));
        state.x = (width - bounds.width * state.scale) / 2 - bounds.x * state.scale;
        state.y = Math.max(22, (height - bounds.height * state.scale) / 2) - bounds.y * state.scale;
        updateTransform();
      }

      function zoomAt(centerX, centerY, nextScale) {
        var boundedScale = Math.max(0.22, Math.min(2.2, nextScale));
        var worldX = (centerX - state.x) / state.scale;
        var worldY = (centerY - state.y) / state.scale;
        state.scale = boundedScale;
        state.x = centerX - worldX * state.scale;
        state.y = centerY - worldY * state.scale;
        updateTransform();
      }

      function render(shouldFit) {
        var model = getVisibleModel();
        renderSvg(model);
        renderDetail();
        updateTransform();
        if (shouldFit) {
          window.setTimeout(fitView, 0);
        }
      }

      function initHeader() {
        document.getElementById('graphTitle').textContent = data.graph.label;
        document.getElementById('graphSummary').textContent = data.graph.summary || '';
        var stats = document.getElementById('stats');
        stats.appendChild(createElement('span', '', data.nodes.length + ' 个节点'));
        stats.appendChild(createElement('span', '', data.edges.length + ' 条关系'));
        stats.appendChild(createElement('span', '', data.lanes.length + ' 条泳道'));
      }

      function initRelationFilter() {
        var relationFilter = document.getElementById('relationFilter');
        var allOption = document.createElement('option');
        allOption.value = 'all';
        allOption.textContent = '全部关系';
        relationFilter.appendChild(allOption);
        data.relationTypes.forEach(function (relationType) {
          var option = document.createElement('option');
          option.value = relationType.value;
          option.textContent = relationType.label;
          relationFilter.appendChild(option);
        });
        relationFilter.addEventListener('change', function (event) {
          state.relationFilter = event.target.value;
          state.selectedEdgeId = '';
          render(true);
        });
      }

      function initEvents() {
        document.getElementById('searchInput').addEventListener('input', function (event) {
          state.searchText = event.target.value;
          state.selectedNodeId = '';
          state.selectedEdgeId = '';
          render(true);
        });
        Array.prototype.forEach.call(document.querySelectorAll('[data-mode]'), function (button) {
          button.addEventListener('click', function () {
            state.mode = button.getAttribute('data-mode');
            state.selectedNodeId = '';
            state.selectedEdgeId = '';
            Array.prototype.forEach.call(document.querySelectorAll('[data-mode]'), function (item) {
              item.classList.toggle('active', item === button);
            });
            render(true);
          });
        });
        document.getElementById('zoomOutButton').addEventListener('click', function () {
          zoomAt((svg.clientWidth || 980) / 2, (svg.clientHeight || 620) / 2, state.scale * 0.82);
        });
        document.getElementById('zoomInButton').addEventListener('click', function () {
          zoomAt((svg.clientWidth || 980) / 2, (svg.clientHeight || 620) / 2, state.scale * 1.18);
        });
        document.getElementById('fitButton').addEventListener('click', fitView);
        svg.addEventListener('click', function () {
          state.selectedNodeId = '';
          state.selectedEdgeId = '';
          render(false);
        });
        svg.addEventListener('pointerdown', function (event) {
          if (event.target.closest && event.target.closest('[data-node-id],[data-edge-id]')) {
            return;
          }
          state.isPanning = true;
          state.lastPointerX = event.clientX;
          state.lastPointerY = event.clientY;
          svg.classList.add('panning');
          svg.setPointerCapture(event.pointerId);
        });
        svg.addEventListener('pointermove', function (event) {
          if (!state.isPanning) {
            return;
          }
          state.x += event.clientX - state.lastPointerX;
          state.y += event.clientY - state.lastPointerY;
          state.lastPointerX = event.clientX;
          state.lastPointerY = event.clientY;
          updateTransform();
        });
        svg.addEventListener('pointerup', function (event) {
          state.isPanning = false;
          svg.classList.remove('panning');
          if (svg.releasePointerCapture) {
            svg.releasePointerCapture(event.pointerId);
          }
        });
        svg.addEventListener('pointercancel', function () {
          state.isPanning = false;
          svg.classList.remove('panning');
        });
        svg.addEventListener('wheel', function (event) {
          event.preventDefault();
          var rect = svg.getBoundingClientRect();
          var centerX = event.clientX - rect.left;
          var centerY = event.clientY - rect.top;
          var factor = event.deltaY > 0 ? 0.88 : 1.12;
          zoomAt(centerX, centerY, state.scale * factor);
        }, { passive: false });
        window.addEventListener('resize', function () {
          render(true);
        });
      }

      initHeader();
      initRelationFilter();
      initEvents();
      render(true);
    })();
  </script>
</body>
</html>`;
}
