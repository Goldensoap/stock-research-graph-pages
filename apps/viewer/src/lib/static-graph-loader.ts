import {
  EdgeStatus,
  GraphAuthoringDocument,
  GraphAuthoringEdge,
  GraphAuthoringNode,
  GraphSnapshot,
  IndustryGraph,
  NODE_WEIGHT_TIERS,
  NODE_TYPES,
  NodeWeightTier,
  RELATION_TYPES,
  RelationType,
  ResearchEdge,
  ResearchLane,
  ResearchNode,
  ResearchNodeType,
} from './graph-types';

export interface StaticGraphIndexItem {
  id: string;
  label: string;
  file: string;
  summary?: string;
}

export interface StaticGraphIndex {
  graphs: StaticGraphIndexItem[];
}

const INDEX_PATH = './data/graphs/index.json';
const EDGE_STATUSES = ['fact', 'research', 'unverified'] as const;

/**
 * 读取静态 JSON 文件。
 * @param path 相对站点根目录的数据路径。
 * @returns 解析后的 JSON 数据。
 */
async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`读取静态数据失败: ${path} (${response.status})`);
  }
  return response.json() as Promise<T>;
}

/**
 * 读取图谱索引文件。
 * @returns 可选择的图谱索引。
 */
export async function loadGraphIndex(): Promise<StaticGraphIndex> {
  const index = await fetchJson<StaticGraphIndex>(INDEX_PATH);
  if (!Array.isArray(index.graphs)) {
    throw new Error('图谱索引格式错误: graphs 必须是数组');
  }
  return {
    graphs: index.graphs.filter((graph) => graph.id && graph.label && graph.file),
  };
}

/**
 * 生成稳定的 URL 片段。
 * @param value 原始文本。
 * @param fallback 兜底文本。
 * @returns 安全的标识文本。
 */
function createSlug(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

/**
 * 判断字符串是否属于指定枚举集合。
 * @param value 待判断文本。
 * @param values 枚举值列表。
 * @returns 是否属于枚举值。
 */
function isEnumValue<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === 'string' && values.includes(value);
}

/**
 * 规范化节点类型。
 * @param value 原始节点类型。
 * @returns 合法节点类型。
 */
function normalizeNodeType(value: unknown): ResearchNodeType {
  return isEnumValue(value, NODE_TYPES) ? value : 'concept';
}

/**
 * 规范化节点权重。
 * @param value 原始节点权重。
 * @returns 合法节点权重。
 */
function normalizeWeightTier(value: unknown): NodeWeightTier {
  return isEnumValue(value, NODE_WEIGHT_TIERS) ? value : 'medium';
}

/**
 * 规范化关系类型。
 * @param value 原始关系类型。
 * @returns 合法关系类型。
 */
function normalizeRelationType(value: unknown): RelationType {
  return isEnumValue(value, RELATION_TYPES) ? value : 'contains';
}

/**
 * 规范化关系状态。
 * @param value 原始关系状态。
 * @returns 合法关系状态。
 */
function normalizeEdgeStatus(value: unknown): EdgeStatus {
  return isEnumValue(value, EDGE_STATUSES) ? value : 'unverified';
}

/**
 * 生成节点默认引用，与编辑 JSON 文档约定保持一致。
 * @param node 可编辑节点。
 * @returns 节点引用文本。
 */
function createDefaultNodeReference(node: Pick<GraphAuthoringNode, 'type' | 'label' | 'market' | 'ticker'>): string {
  if (node.type === 'company' && node.market && node.ticker) {
    return `${node.type}:${node.label}:${node.market}:${node.ticker}`;
  }
  return `${node.type}:${node.label}`;
}

/**
 * 建立节点引用索引。
 * @param node 原始节点。
 * @param nodeId 节点 ID。
 * @param nodeByReference 引用到节点 ID 的映射。
 * @param ambiguousReferences 已发现歧义的引用集合。
 */
function indexNodeReference(
  node: GraphAuthoringNode,
  nodeId: string,
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
    if (existingNodeId && existingNodeId !== nodeId) {
      nodeByReference.delete(reference);
      ambiguousReferences.add(reference);
      continue;
    }
    nodeByReference.set(reference, nodeId);
  }
}

/**
 * 解析关系端点引用。
 * @param edge 可编辑关系。
 * @param side 端点字段名。
 * @param nodeByReference 节点引用索引。
 * @returns 解析得到的节点 ID。
 */
function resolveEdgeEndpoint(
  edge: GraphAuthoringEdge,
  side: 'from' | 'to',
  nodeByReference: Map<string, string>
): string {
  const reference = edge[side];
  const nodeId = nodeByReference.get(reference);
  if (!nodeId) {
    throw new Error(`关系引用不存在: ${reference}`);
  }
  return nodeId;
}

/**
 * 将可编辑 JSON 文档转换为只读画布快照。
 * @param document 可编辑图谱文档。
 * @param graphId 静态图谱 ID。
 * @returns 画布快照。
 */
export function createSnapshotFromAuthoringDocument(
  document: GraphAuthoringDocument,
  graphId: string
): GraphSnapshot {
  if (document.kind !== 'stock-research-graph.authoring' || document.schemaVersion !== 2) {
    throw new Error('图谱 JSON 必须使用 stock-research-graph.authoring v2 格式');
  }

  const nowText = document.graph.label;
  const graph: IndustryGraph = {
    id: graphId,
    label: document.graph.label,
    summary: document.graph.summary || '',
    sortOrder: document.graph.sortOrder ?? 10,
    createdAt: nowText,
    updatedAt: nowText,
  };

  const lanes: ResearchLane[] = document.lanes.map((lane, index) => ({
    id: `lane-${createSlug(lane.label, String(index + 1))}`,
    graphId,
    label: lane.label,
    color: lane.color || '#2563eb',
    sortOrder: lane.order ?? (index + 1) * 10,
    createdAt: nowText,
    updatedAt: nowText,
  }));
  const laneIdByLabel = new Map(lanes.map((lane) => [lane.label, lane.id]));
  const nodeByReference = new Map<string, string>();
  const ambiguousReferences = new Set<string>();

  const nodes: ResearchNode[] = document.nodes.map((node, index) => {
    const normalizedType = normalizeNodeType(node.type);
    const normalizedNode: GraphAuthoringNode = {
      ...node,
      type: normalizedType,
      label: node.label.trim(),
    };
    const nodeId = `node-${createSlug(`${normalizedType}-${normalizedNode.label}-${node.market || ''}-${node.ticker || ''}`, String(index + 1))}`;
    indexNodeReference(normalizedNode, nodeId, nodeByReference, ambiguousReferences);
    return {
      id: nodeId,
      type: normalizedType,
      laneId: node.lane ? laneIdByLabel.get(node.lane) || '' : '',
      sortOrder: node.order ?? (index + 1) * 10,
      label: normalizedNode.label,
      weightTier: normalizeWeightTier(node.weightTier),
      summary: node.summary || '',
      ticker: node.ticker || '',
      market: node.market || '',
      createdAt: nowText,
      updatedAt: nowText,
    };
  });

  const edges: ResearchEdge[] = document.edges.map((edge, index) => ({
    id: `edge-${index + 1}`,
    graphId,
    sourceId: resolveEdgeEndpoint(edge, 'from', nodeByReference),
    targetId: resolveEdgeEndpoint(edge, 'to', nodeByReference),
    relationType: normalizeRelationType(edge.relationType),
    status: normalizeEdgeStatus(edge.status),
    weight: edge.weight ?? 1,
    note: edge.note || '',
    createdAt: nowText,
    updatedAt: nowText,
  }));

  return {
    graphs: [graph],
    currentGraphId: graphId,
    lanes,
    nodes,
    edges,
  };
}

/**
 * 读取并转换指定图谱。
 * @param item 图谱索引项。
 * @returns 画布快照。
 */
export async function loadGraphSnapshot(item: StaticGraphIndexItem): Promise<GraphSnapshot> {
  const document = await fetchJson<GraphAuthoringDocument>(`./data/graphs/${item.file}`);
  return createSnapshotFromAuthoringDocument(document, item.id);
}
