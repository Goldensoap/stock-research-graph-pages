import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import {
  EDGE_STATUSES,
  EdgeInput,
  EdgeStatus,
  GraphAuthoringDocument,
  GraphAuthoringEdge,
  GraphAuthoringLane,
  GraphAuthoringNode,
  GraphExportDocument,
  GraphExportNode,
  GraphInput,
  GraphImportResult,
  GraphImportValidationIssue,
  GraphNodeMembership,
  GraphSnapshot,
  IndustryGraph,
  LaneInput,
  NODE_WEIGHT_TIERS,
  NODE_TYPES,
  NodeWeightTier,
  NodeInput,
  RELATION_TYPES,
  RelationType,
  ResearchEdge,
  ResearchLane,
  ResearchNode,
  ResearchNodeType,
} from './graph-types';
import { validateStockTicker } from './market-rules';

const DEFAULT_DATABASE_PATH = join(process.cwd(), 'data', 'research-graph.sqlite3');
const DATABASE_PATH = process.env.RESEARCH_GRAPH_DB_PATH || DEFAULT_DATABASE_PATH;
const GRAPH_EXPORT_SCHEMA_VERSION = 1;
const GRAPH_EXPORT_KIND = 'stock-research-graph.graph';
const GRAPH_AUTHORING_SCHEMA_VERSION = 2;
const GRAPH_AUTHORING_KIND = 'stock-research-graph.authoring';

let database: Database.Database | null = null;

interface GraphRow {
  id: string;
  label: string;
  summary: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface LaneRow {
  id: string;
  graph_id: string;
  label: string;
  color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface NodeRow {
  id: string;
  type: ResearchNodeType;
  lane_id?: string | null;
  sort_order?: number | null;
  label: string;
  weight_tier: NodeWeightTier;
  summary: string | null;
  ticker: string | null;
  market: string | null;
  created_at: string;
  updated_at: string;
}

interface GraphNodeRow {
  graph_id: string;
  node_id: string;
  lane_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface EdgeRow {
  id: string;
  graph_id: string;
  source_id: string;
  target_id: string;
  relation_type: RelationType;
  status: EdgeStatus;
  weight: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

interface ValidatedGraphExportDocument extends GraphExportDocument {
  schemaVersion: 1;
  kind: 'stock-research-graph.graph';
}

/**
 * 图谱导入校验失败错误。
 */
export class GraphImportValidationError extends Error {
  issues: GraphImportValidationIssue[];

  /**
   * 创建图谱导入校验错误。
   * @param issues 字段级错误列表。
   */
  constructor(issues: GraphImportValidationIssue[]) {
    super(formatValidationIssueSummary(issues));
    this.name = 'GraphImportValidationError';
    this.issues = issues;
  }
}

/**
 * 获取当前 ISO 时间字符串。
 * @returns 当前时间的 ISO 格式文本。
 */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 清理输入文本。
 * @param value 原始输入。
 * @param fallback 空值时的默认文本。
 * @returns 去除首尾空白后的文本。
 */
function cleanText(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : fallback;
}

/**
 * 校验枚举字段。
 * @param value 待校验值。
 * @param allowedValues 允许值列表。
 * @param fieldName 字段名称。
 * @returns 合法枚举值。
 */
function parseEnum<T extends readonly string[]>(
  value: unknown,
  allowedValues: T,
  fieldName: string
): T[number] {
  if (typeof value !== 'string' || !allowedValues.includes(value)) {
    throw new Error(`${fieldName} 无效: ${String(value)}`);
  }
  return value as T[number];
}

/**
 * 格式化导入校验错误摘要。
 * @param issues 字段级错误列表。
 * @returns 可直接展示给用户的摘要。
 */
function formatValidationIssueSummary(issues: GraphImportValidationIssue[]): string {
  if (issues.length === 0) {
    return '图谱 JSON 校验失败';
  }
  const preview = issues
    .slice(0, 6)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join('；');
  const omitted = issues.length > 6 ? `；另有 ${issues.length - 6} 处错误` : '';
  return `图谱 JSON 校验失败：${preview}${omitted}`;
}

/**
 * 记录字段级导入错误。
 * @param issues 字段级错误列表。
 * @param path JSON 字段路径。
 * @param message 错误说明。
 */
function addImportIssue(issues: GraphImportValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

/**
 * 判断值是否为普通对象。
 * @param value 待判断值。
 * @returns 是否为普通对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 读取 JSON 对象字段。
 * @param value 原始值。
 * @param path 字段路径。
 * @param issues 字段级错误列表。
 * @returns JSON 对象。
 */
function readRecord(value: unknown, path: string, issues: GraphImportValidationIssue[]): Record<string, unknown> {
  if (!isRecord(value)) {
    addImportIssue(issues, path, '必须是对象');
    return {};
  }
  return value;
}

/**
 * 读取 JSON 数组字段。
 * @param record 所属对象。
 * @param path 字段路径。
 * @param field 字段名。
 * @param issues 字段级错误列表。
 * @returns JSON 数组。
 */
function readArrayField(
  record: Record<string, unknown>,
  path: string,
  field: string,
  issues: GraphImportValidationIssue[]
): unknown[] {
  const value = record[field];
  if (!Array.isArray(value)) {
    addImportIssue(issues, `${path}.${field}`, '必须是数组');
    return [];
  }
  return value;
}

/**
 * 读取字符串字段。
 * @param record 所属对象。
 * @param path 字段路径。
 * @param field 字段名。
 * @param issues 字段级错误列表。
 * @returns 去除首尾空白后的字符串。
 */
function readStringField(
  record: Record<string, unknown>,
  path: string,
  field: string,
  issues: GraphImportValidationIssue[]
): string {
  const value = record[field];
  if (typeof value !== 'string') {
    addImportIssue(issues, `${path}.${field}`, '必须是字符串');
    return '';
  }
  return value.trim();
}

/**
 * 读取非空字符串字段。
 * @param record 所属对象。
 * @param path 字段路径。
 * @param field 字段名。
 * @param issues 字段级错误列表。
 * @returns 去除首尾空白后的非空字符串。
 */
function readNonEmptyStringField(
  record: Record<string, unknown>,
  path: string,
  field: string,
  issues: GraphImportValidationIssue[]
): string {
  const value = readStringField(record, path, field, issues);
  if (!value) {
    addImportIssue(issues, `${path}.${field}`, '不能为空');
  }
  return value;
}

/**
 * 读取有限数字字段。
 * @param record 所属对象。
 * @param path 字段路径。
 * @param field 字段名。
 * @param issues 字段级错误列表。
 * @returns 有限数字。
 */
function readNumberField(
  record: Record<string, unknown>,
  path: string,
  field: string,
  issues: GraphImportValidationIssue[]
): number {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    addImportIssue(issues, `${path}.${field}`, '必须是有限数字');
    return 0;
  }
  return value;
}

/**
 * 读取枚举字段。
 * @param record 所属对象。
 * @param path 字段路径。
 * @param field 字段名。
 * @param allowedValues 允许值列表。
 * @param fallback 校验失败时的默认值。
 * @param issues 字段级错误列表。
 * @returns 枚举字段值。
 */
function readEnumField<T extends readonly string[]>(
  record: Record<string, unknown>,
  path: string,
  field: string,
  allowedValues: T,
  fallback: T[number],
  issues: GraphImportValidationIssue[]
): T[number] {
  const value = record[field];
  if (typeof value !== 'string' || !allowedValues.includes(value)) {
    addImportIssue(issues, `${path}.${field}`, `必须是 ${allowedValues.join(' / ')} 之一`);
    return fallback;
  }
  return value as T[number];
}

/**
 * 检查 ID 是否重复。
 * @param id 当前 ID。
 * @param path 字段路径。
 * @param seenIds 已出现 ID 集合。
 * @param issues 字段级错误列表。
 */
function assertUniqueId(
  id: string,
  path: string,
  seenIds: Set<string>,
  issues: GraphImportValidationIssue[]
): void {
  if (!id) {
    return;
  }
  if (seenIds.has(id)) {
    addImportIssue(issues, path, `ID 重复: ${id}`);
    return;
  }
  seenIds.add(id);
}

/**
 * 将文本转换为可读稳定片段。
 * @param value 原始文本。
 * @returns 可用于内部 ID 的片段。
 */
function slugifyText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'item';
}

/**
 * 生成稳定短哈希。
 * @param value 原始文本。
 * @returns 十六进制短哈希。
 */
function hashText(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 10);
}

/**
 * 判断值是否为有限数字，否则返回默认值。
 * @param value 原始值。
 * @param fallback 默认值。
 * @returns 有限数字。
 */
function readOptionalNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * 生成图谱名称对应的稳定内部 ID。
 * @param label 图谱名称。
 * @returns 图谱内部 ID。
 */
function createStableGraphId(label: string): string {
  return `graph-${slugifyText(label)}-${hashText(label)}`;
}

/**
 * 生成泳道对应的稳定内部 ID。
 * @param graphLabel 图谱名称。
 * @param laneLabel 泳道名称。
 * @returns 泳道内部 ID。
 */
function createStableLaneId(graphLabel: string, laneLabel: string): string {
  const identity = `${graphLabel}\u0000${laneLabel}`;
  return `lane-${slugifyText(graphLabel)}-${slugifyText(laneLabel)}-${hashText(identity)}`;
}

/**
 * 生成节点对应的稳定内部 ID。
 * @param nodeType 节点类型。
 * @param label 节点名称。
 * @param market 上市市场。
 * @param ticker 证券代码。
 * @returns 节点内部 ID。
 */
function createStableNodeId(
  nodeType: ResearchNodeType,
  label: string,
  market: string,
  ticker: string
): string {
  if (nodeType === 'company' && market && ticker) {
    const identity = `${nodeType}\u0000${market}\u0000${ticker}`;
    return `node-company-${slugifyText(market)}-${slugifyText(ticker)}-${hashText(identity)}`;
  }
  const identity = `${nodeType}\u0000${label}`;
  return `node-${slugifyText(nodeType)}-${slugifyText(label)}-${hashText(identity)}`;
}

/**
 * 生成关系对应的稳定内部 ID。
 * @param graphLabel 图谱名称。
 * @param sourceId 来源节点 ID。
 * @param targetId 目标节点 ID。
 * @param relationType 关系类型。
 * @returns 关系内部 ID。
 */
function createStableEdgeId(
  graphLabel: string,
  sourceId: string,
  targetId: string,
  relationType: RelationType
): string {
  const identity = `${graphLabel}\u0000${sourceId}\u0000${relationType}\u0000${targetId}`;
  return `edge-${slugifyText(graphLabel)}-${slugifyText(sourceId)}-${slugifyText(relationType)}-${slugifyText(targetId)}-${hashText(identity)}`;
}

/**
 * 获取节点在外部格式中的唯一键。
 * @param node 节点实体。
 * @returns 节点唯一键。
 */
function createNodeIdentityKey(node: Pick<GraphExportNode, 'type' | 'label' | 'market' | 'ticker'>): string {
  if (node.type === 'company' && node.market && node.ticker) {
    return `company\u0000${node.market}\u0000${node.ticker}`;
  }
  return `${node.type}\u0000${node.label}`;
}

/**
 * 获取外部节点默认引用文本。
 * @param node 节点实体。
 * @returns 外部引用文本。
 */
function createDefaultNodeReference(node: Pick<GraphExportNode, 'type' | 'label' | 'market' | 'ticker'>): string {
  if (node.type === 'company' && node.market && node.ticker) {
    return `${node.type}:${node.label}:${node.market}:${node.ticker}`;
  }
  return `${node.type}:${node.label}`;
}

/**
 * 准备公司节点上市字段。
 * @param nodeType 节点类型。
 * @param marketInput 市场输入。
 * @param tickerInput 证券代码输入。
 * @returns 标准化后的市场和代码。
 */
function prepareNodeListingFields(
  nodeType: ResearchNodeType,
  marketInput: unknown,
  tickerInput: unknown
): { market: string; ticker: string } {
  if (nodeType !== 'company') {
    return { market: '', ticker: '' };
  }

  const rawMarket = cleanText(marketInput);
  const rawTicker = cleanText(tickerInput);
  if (!rawMarket && !rawTicker) {
    return { market: '', ticker: '' };
  }
  if (!rawMarket || !rawTicker) {
    throw new Error('公司节点填写市场或代码时，市场和代码必须同时填写');
  }

  const validation = validateStockTicker(rawMarket, rawTicker);
  if (!validation.isValid) {
    throw new Error(validation.message);
  }
  return {
    market: validation.market,
    ticker: validation.ticker,
  };
}

/**
 * 将数据库图谱行转换为前端格式。
 * @param row 数据库图谱行。
 * @returns 产业图谱。
 */
function mapGraph(row: GraphRow): IndustryGraph {
  return {
    id: row.id,
    label: row.label,
    summary: row.summary || '',
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 将数据库泳道行转换为前端格式。
 * @param row 数据库泳道行。
 * @returns 研究泳道。
 */
function mapLane(row: LaneRow): ResearchLane {
  return {
    id: row.id,
    graphId: row.graph_id,
    label: row.label,
    color: row.color,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 将数据库节点行转换为前端格式。
 * @param row 数据库节点行。
 * @returns 研究节点。
 */
function mapNode(row: NodeRow): ResearchNode {
  return {
    id: row.id,
    type: row.type,
    laneId: row.lane_id || '',
    sortOrder: row.sort_order || 0,
    label: row.label,
    weightTier: row.weight_tier,
    summary: row.summary || '',
    ticker: row.ticker || '',
    market: row.market || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 将数据库节点行转换为导出格式。
 * @param row 数据库节点行。
 * @returns 导出用节点实体。
 */
function mapExportNode(row: NodeRow): GraphExportNode {
  return {
    id: row.id,
    type: row.type,
    label: row.label,
    weightTier: row.weight_tier,
    summary: row.summary || '',
    ticker: row.ticker || '',
    market: row.market || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 将数据库图谱节点归属行转换为导出格式。
 * @param row 数据库图谱节点归属行。
 * @returns 导出用节点归属记录。
 */
function mapMembership(row: GraphNodeRow): GraphNodeMembership {
  return {
    graphId: row.graph_id,
    nodeId: row.node_id,
    laneId: row.lane_id || '',
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 将数据库关系行转换为前端格式。
 * @param row 数据库关系行。
 * @returns 研究关系。
 */
function mapEdge(row: EdgeRow): ResearchEdge {
  return {
    id: row.id,
    graphId: row.graph_id,
    sourceId: row.source_id,
    targetId: row.target_id,
    relationType: row.relation_type,
    status: row.status,
    weight: row.weight,
    note: row.note || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 初始化干净的多图谱数据库结构。
 * @param db SQLite 数据库连接。
 */
function initializeSchema(db: Database.Database): void {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS industry_graphs (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_industry_graphs_sort
      ON industry_graphs(sort_order, label);

    CREATE TABLE IF NOT EXISTS lanes (
      id TEXT PRIMARY KEY,
      graph_id TEXT NOT NULL,
      label TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#2563eb',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (graph_id) REFERENCES industry_graphs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_lanes_graph_sort
      ON lanes(graph_id, sort_order);

    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('narrative', 'industry', 'concept', 'product', 'material', 'process', 'company')),
      label TEXT NOT NULL,
      weight_tier TEXT NOT NULL DEFAULT 'medium' CHECK (weight_tier IN ('high', 'medium', 'low')),
      summary TEXT NOT NULL DEFAULT '',
      ticker TEXT NOT NULL DEFAULT '',
      market TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_nodes_type_label
      ON nodes(type, label);

    CREATE TABLE IF NOT EXISTS graph_nodes (
      graph_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      lane_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (graph_id, node_id),
      FOREIGN KEY (graph_id) REFERENCES industry_graphs(id) ON DELETE CASCADE,
      FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (lane_id) REFERENCES lanes(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_graph_nodes_lane
      ON graph_nodes(graph_id, lane_id);

    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY,
      graph_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL CHECK (relation_type IN ('contains', 'upstream', 'downstream', 'produces', 'supplies', 'benefits', 'substitute', 'competition', 'exposure')),
      status TEXT NOT NULL CHECK (status IN ('fact', 'research', 'unverified')),
      weight REAL NOT NULL DEFAULT 1,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (graph_id) REFERENCES industry_graphs(id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES nodes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_edges_graph
      ON edges(graph_id);

    CREATE INDEX IF NOT EXISTS idx_edges_source
      ON edges(graph_id, source_id);

    CREATE INDEX IF NOT EXISTS idx_edges_target
      ON edges(graph_id, target_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_unique_relation
      ON edges(graph_id, source_id, target_id, relation_type);

  `);
}

/**
 * 查询图谱是否存在。
 * @param db SQLite 数据库连接。
 * @param graphId 图谱 ID。
 */
function assertGraphExists(db: Database.Database, graphId: string): void {
  const graph = db.prepare('SELECT id FROM industry_graphs WHERE id = ?').get(graphId);
  if (!graph) {
    throw new Error(`产业图谱不存在: ${graphId}`);
  }
}

/**
 * 将节点加入图谱上下文。
 * @param db SQLite 数据库连接。
 * @param graphId 图谱 ID。
 * @param nodeId 节点 ID。
 * @param laneId 泳道 ID。
 */
function ensureGraphNode(
  db: Database.Database,
  graphId: string,
  nodeId: string,
  laneId?: string
): void {
  const timestamp = nowIso();
  db.prepare(`
    INSERT INTO graph_nodes (graph_id, node_id, lane_id, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, 0, ?, ?)
    ON CONFLICT(graph_id, node_id) DO UPDATE SET
      lane_id = COALESCE(excluded.lane_id, graph_nodes.lane_id),
      updated_at = excluded.updated_at
  `).run(graphId, nodeId, laneId || null, timestamp, timestamp);
}

/**
 * 写入首屏样例数据。
 * @param db SQLite 数据库连接。
 */
function seedInitialData(db: Database.Database): void {
  const graphCount = db.prepare('SELECT COUNT(*) AS count FROM industry_graphs').get() as { count: number };
  if (graphCount.count > 0) {
    return;
  }

  const timestamp = nowIso();
  const insertGraph = db.prepare(`
    INSERT INTO industry_graphs (id, label, summary, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertLane = db.prepare(`
    INSERT INTO lanes (id, graph_id, label, color, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertNode = db.prepare(`
    INSERT INTO nodes (id, type, label, weight_tier, summary, ticker, market, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertGraphNode = db.prepare(`
    INSERT INTO graph_nodes (graph_id, node_id, lane_id, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertEdge = db.prepare(`
    INSERT INTO edges (id, graph_id, source_id, target_id, relation_type, status, weight, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const writeSeed = db.transaction(() => {
    const graphs: IndustryGraph[] = [
      {
        id: 'graph-ai-server',
        label: 'AI服务器',
        summary: '围绕训练和推理服务器展开的产业图谱。',
        sortOrder: 10,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: 'graph-embodied-ai',
        label: '具身智能',
        summary: '围绕机器人本体、执行器、传感器和算力平台展开的产业图谱。',
        sortOrder: 20,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];

    for (const graph of graphs) {
      insertGraph.run(graph.id, graph.label, graph.summary, graph.sortOrder, timestamp, timestamp);
    }

    const lanes: Array<Pick<ResearchLane, 'id' | 'graphId' | 'label' | 'color' | 'sortOrder'>> = [
      { id: 'lane-ai-compute', graphId: 'graph-ai-server', label: '算力芯片', color: '#2563eb', sortOrder: 10 },
      { id: 'lane-ai-board', graphId: 'graph-ai-server', label: 'PCB 与材料', color: '#0f766e', sortOrder: 20 },
      { id: 'lane-ai-interconnect', graphId: 'graph-ai-server', label: '互联与光模块', color: '#7c3aed', sortOrder: 30 },
      { id: 'lane-ai-infra', graphId: 'graph-ai-server', label: '能源、液冷、厂房', color: '#ea580c', sortOrder: 40 },
      { id: 'lane-ai-manufacturing', graphId: 'graph-ai-server', label: '制造、封测、设备', color: '#475569', sortOrder: 50 },
      { id: 'lane-robot-brain', graphId: 'graph-embodied-ai', label: '大脑与模型', color: '#2563eb', sortOrder: 10 },
      { id: 'lane-robot-body', graphId: 'graph-embodied-ai', label: '机器人本体', color: '#0f766e', sortOrder: 20 },
      { id: 'lane-robot-actuator', graphId: 'graph-embodied-ai', label: '执行器与关节', color: '#7c3aed', sortOrder: 30 },
      { id: 'lane-robot-sensor', graphId: 'graph-embodied-ai', label: '传感器', color: '#ea580c', sortOrder: 40 },
      { id: 'lane-robot-manufacturing', graphId: 'graph-embodied-ai', label: '制造与集成', color: '#475569', sortOrder: 50 },
    ];

    for (const lane of lanes) {
      insertLane.run(lane.id, lane.graphId, lane.label, lane.color, lane.sortOrder, timestamp, timestamp);
    }

    const nodes: Array<Omit<ResearchNode, 'laneId' | 'sortOrder' | 'createdAt' | 'updatedAt'>> = [
      { id: 'narrative-ai-server', type: 'narrative', label: 'AI服务器', weightTier: 'high', summary: 'AI 训练和推理服务器产业叙事。', ticker: '', market: '' },
      { id: 'concept-gpu', type: 'concept', label: 'GPU', weightTier: 'high', summary: 'AI 训练和推理核心加速芯片。', ticker: '', market: '' },
      { id: 'concept-tpu', type: 'concept', label: 'TPU/ASIC', weightTier: 'medium', summary: '专用 AI 加速芯片路线。', ticker: '', market: '' },
      { id: 'concept-pcb', type: 'concept', label: 'PCB', weightTier: 'high', summary: '服务器主板、加速卡和交换机基础环节。', ticker: '', market: '' },
      { id: 'material-ccl', type: 'material', label: '覆铜板', weightTier: 'medium', summary: 'PCB 上游核心材料。', ticker: '', market: '' },
      { id: 'material-copper-foil', type: 'material', label: '铜箔', weightTier: 'low', summary: '覆铜板关键材料之一。', ticker: '', market: '' },
      { id: 'concept-optical-module', type: 'concept', label: '光模块', weightTier: 'high', summary: '数据中心高速互联环节。', ticker: '', market: '' },
      { id: 'concept-energy', type: 'concept', label: '能源与液冷', weightTier: 'medium', summary: '高功耗服务器配套环节。', ticker: '', market: '' },
      { id: 'concept-packaging-test', type: 'concept', label: '封测', weightTier: 'medium', summary: '芯片封装、测试与相关配套服务。', ticker: '', market: '' },
      { id: 'concept-fab-facility', type: 'concept', label: '厂房与洁净室', weightTier: 'low', summary: '晶圆厂、封测厂和数据中心建设配套。', ticker: '', market: '' },
      { id: 'concept-cxmt-chain', type: 'concept', label: '长鑫存储产业链', weightTier: 'medium', summary: '国产存储链条相关产业环节。', ticker: '', market: '' },
      { id: 'narrative-embodied-ai', type: 'narrative', label: '具身智能', weightTier: 'high', summary: '机器人本体、模型、执行器和传感器产业叙事。', ticker: '', market: '' },
      { id: 'concept-robot-foundation-model', type: 'concept', label: '机器人基础模型', weightTier: 'high', summary: '机器人决策、规划和交互模型。', ticker: '', market: '' },
      { id: 'concept-humanoid-body', type: 'product', label: '人形机器人本体', weightTier: 'high', summary: '整机、本体结构和集成平台。', ticker: '', market: '' },
      { id: 'concept-actuator', type: 'concept', label: '执行器', weightTier: 'medium', summary: '机器人运动执行单元。', ticker: '', market: '' },
      { id: 'concept-reducer', type: 'material', label: '减速器', weightTier: 'medium', summary: '机器人关节关键部件。', ticker: '', market: '' },
      { id: 'concept-force-sensor', type: 'concept', label: '力传感器', weightTier: 'medium', summary: '机器人触觉和力控相关传感器。', ticker: '', market: '' },
      { id: 'concept-vision-sensor', type: 'concept', label: '视觉传感器', weightTier: 'medium', summary: '机器人环境感知相关硬件。', ticker: '', market: '' },
      { id: 'company-nvidia', type: 'company', label: 'NVIDIA', weightTier: 'high', summary: 'AI GPU 龙头公司。', ticker: 'NVDA', market: '美股' },
      { id: 'company-shenghong', type: 'company', label: '胜宏科技', weightTier: 'medium', summary: 'PCB 与高端板相关公司。', ticker: '300476', market: 'A股' },
      { id: 'company-hudian', type: 'company', label: '沪电股份', weightTier: 'medium', summary: 'PCB 相关上市公司。', ticker: '002463', market: 'A股' },
      { id: 'company-shengyi', type: 'company', label: '生益科技', weightTier: 'medium', summary: '覆铜板和电子材料相关公司。', ticker: '600183', market: 'A股' },
      { id: 'company-asml', type: 'company', label: 'ASML', weightTier: 'high', summary: '先进制程光刻设备核心公司。', ticker: 'ASML', market: '欧洲股市' },
      { id: 'company-tsmc', type: 'company', label: '台积电', weightTier: 'high', summary: '先进制程晶圆代工公司。', ticker: 'TSM', market: '美股' },
      { id: 'company-taiji-industry', type: 'company', label: '太极实业', weightTier: 'low', summary: '半导体工程、封测和厂房配套相关公司。', ticker: '600667', market: 'A股' },
      { id: 'company-cxmt', type: 'company', label: '长鑫存储', weightTier: 'medium', summary: '国产 DRAM 厂商。', ticker: '', market: '' },
      { id: 'company-tesla', type: 'company', label: 'Tesla', weightTier: 'high', summary: '具身智能和机器人整机代表公司。', ticker: 'TSLA', market: '美股' },
      { id: 'company-top-group', type: 'company', label: '拓普集团', weightTier: 'medium', summary: '机器人执行器和汽车零部件相关公司。', ticker: '601689', market: 'A股' },
      { id: 'company-harmonic', type: 'company', label: '绿的谐波', weightTier: 'medium', summary: '精密减速器相关公司。', ticker: '688017', market: 'A股' },
      { id: 'company-hesai', type: 'company', label: '禾赛科技', weightTier: 'low', summary: '激光雷达和感知硬件相关公司。', ticker: 'HSAI', market: '美股' },
    ];

    for (const node of nodes) {
      insertNode.run(node.id, node.type, node.label, node.weightTier, node.summary, node.ticker, node.market, timestamp, timestamp);
    }

    const graphNodes: Array<{ graphId: string; nodeId: string; laneId?: string; sortOrder: number }> = [
      { graphId: 'graph-ai-server', nodeId: 'narrative-ai-server', sortOrder: 0 },
      { graphId: 'graph-ai-server', nodeId: 'concept-gpu', laneId: 'lane-ai-compute', sortOrder: 10 },
      { graphId: 'graph-ai-server', nodeId: 'concept-tpu', laneId: 'lane-ai-compute', sortOrder: 20 },
      { graphId: 'graph-ai-server', nodeId: 'concept-pcb', laneId: 'lane-ai-board', sortOrder: 10 },
      { graphId: 'graph-ai-server', nodeId: 'material-ccl', laneId: 'lane-ai-board', sortOrder: 20 },
      { graphId: 'graph-ai-server', nodeId: 'material-copper-foil', laneId: 'lane-ai-board', sortOrder: 30 },
      { graphId: 'graph-ai-server', nodeId: 'concept-optical-module', laneId: 'lane-ai-interconnect', sortOrder: 10 },
      { graphId: 'graph-ai-server', nodeId: 'concept-energy', laneId: 'lane-ai-infra', sortOrder: 10 },
      { graphId: 'graph-ai-server', nodeId: 'concept-fab-facility', laneId: 'lane-ai-infra', sortOrder: 20 },
      { graphId: 'graph-ai-server', nodeId: 'concept-packaging-test', laneId: 'lane-ai-manufacturing', sortOrder: 10 },
      { graphId: 'graph-ai-server', nodeId: 'concept-cxmt-chain', laneId: 'lane-ai-manufacturing', sortOrder: 20 },
      { graphId: 'graph-ai-server', nodeId: 'company-nvidia', sortOrder: 0 },
      { graphId: 'graph-ai-server', nodeId: 'company-shenghong', sortOrder: 0 },
      { graphId: 'graph-ai-server', nodeId: 'company-hudian', sortOrder: 0 },
      { graphId: 'graph-ai-server', nodeId: 'company-shengyi', sortOrder: 0 },
      { graphId: 'graph-ai-server', nodeId: 'company-asml', sortOrder: 0 },
      { graphId: 'graph-ai-server', nodeId: 'company-tsmc', sortOrder: 0 },
      { graphId: 'graph-ai-server', nodeId: 'company-taiji-industry', sortOrder: 0 },
      { graphId: 'graph-ai-server', nodeId: 'company-cxmt', sortOrder: 0 },
      { graphId: 'graph-embodied-ai', nodeId: 'narrative-embodied-ai', sortOrder: 0 },
      { graphId: 'graph-embodied-ai', nodeId: 'concept-robot-foundation-model', laneId: 'lane-robot-brain', sortOrder: 10 },
      { graphId: 'graph-embodied-ai', nodeId: 'concept-humanoid-body', laneId: 'lane-robot-body', sortOrder: 10 },
      { graphId: 'graph-embodied-ai', nodeId: 'concept-actuator', laneId: 'lane-robot-actuator', sortOrder: 10 },
      { graphId: 'graph-embodied-ai', nodeId: 'concept-reducer', laneId: 'lane-robot-actuator', sortOrder: 20 },
      { graphId: 'graph-embodied-ai', nodeId: 'concept-force-sensor', laneId: 'lane-robot-sensor', sortOrder: 10 },
      { graphId: 'graph-embodied-ai', nodeId: 'concept-vision-sensor', laneId: 'lane-robot-sensor', sortOrder: 20 },
      { graphId: 'graph-embodied-ai', nodeId: 'company-nvidia', sortOrder: 0 },
      { graphId: 'graph-embodied-ai', nodeId: 'company-tesla', sortOrder: 0 },
      { graphId: 'graph-embodied-ai', nodeId: 'company-top-group', sortOrder: 0 },
      { graphId: 'graph-embodied-ai', nodeId: 'company-harmonic', sortOrder: 0 },
      { graphId: 'graph-embodied-ai', nodeId: 'company-hesai', sortOrder: 0 },
    ];

    for (const graphNode of graphNodes) {
      insertGraphNode.run(graphNode.graphId, graphNode.nodeId, graphNode.laneId || null, graphNode.sortOrder, timestamp, timestamp);
    }

    const edges: Array<EdgeInput & { id: string; graphId: string }> = [
      { id: 'edge-ai-gpu', graphId: 'graph-ai-server', sourceId: 'narrative-ai-server', targetId: 'concept-gpu', relationType: 'contains', status: 'fact', note: 'AI 服务器核心算力环节。' },
      { id: 'edge-ai-tpu', graphId: 'graph-ai-server', sourceId: 'narrative-ai-server', targetId: 'concept-tpu', relationType: 'contains', status: 'fact', note: '专用加速芯片路线。' },
      { id: 'edge-ai-pcb', graphId: 'graph-ai-server', sourceId: 'narrative-ai-server', targetId: 'concept-pcb', relationType: 'contains', status: 'fact', note: '高速 PCB 是服务器和交换设备基础。' },
      { id: 'edge-pcb-ccl', graphId: 'graph-ai-server', sourceId: 'concept-pcb', targetId: 'material-ccl', relationType: 'upstream', status: 'fact', note: '覆铜板是 PCB 上游核心材料。' },
      { id: 'edge-ccl-copper', graphId: 'graph-ai-server', sourceId: 'material-ccl', targetId: 'material-copper-foil', relationType: 'upstream', status: 'research', note: '铜箔构成覆铜板导电层。' },
      { id: 'edge-ai-optical', graphId: 'graph-ai-server', sourceId: 'narrative-ai-server', targetId: 'concept-optical-module', relationType: 'contains', status: 'fact', note: '集群互联依赖高速光模块。' },
      { id: 'edge-ai-energy', graphId: 'graph-ai-server', sourceId: 'narrative-ai-server', targetId: 'concept-energy', relationType: 'contains', status: 'research', note: '高功耗带来能源与散热需求。' },
      { id: 'edge-ai-packaging-test', graphId: 'graph-ai-server', sourceId: 'narrative-ai-server', targetId: 'concept-packaging-test', relationType: 'contains', status: 'research', note: '高端芯片链条中的封测环节。' },
      { id: 'edge-ai-fab-facility', graphId: 'graph-ai-server', sourceId: 'narrative-ai-server', targetId: 'concept-fab-facility', relationType: 'contains', status: 'research', note: '算力与存储扩产带来的厂房配套需求。' },
      { id: 'edge-cxmt-packaging', graphId: 'graph-ai-server', sourceId: 'concept-cxmt-chain', targetId: 'concept-packaging-test', relationType: 'contains', status: 'research', note: '长鑫相关封测配套环节。' },
      { id: 'edge-shenghong-pcb', graphId: 'graph-ai-server', sourceId: 'company-shenghong', targetId: 'concept-pcb', relationType: 'produces', status: 'fact', note: '胜宏科技与 PCB 环节相关。' },
      { id: 'edge-shenghong-nvidia', graphId: 'graph-ai-server', sourceId: 'company-shenghong', targetId: 'company-nvidia', relationType: 'supplies', status: 'fact', note: '公司关系图谱样例：AI服务器背景下的供应关系。' },
      { id: 'edge-taiji-packaging', graphId: 'graph-ai-server', sourceId: 'company-taiji-industry', targetId: 'concept-packaging-test', relationType: 'exposure', status: 'research', note: '太极实业可同时关联封测环节。' },
      { id: 'edge-taiji-facility', graphId: 'graph-ai-server', sourceId: 'company-taiji-industry', targetId: 'concept-fab-facility', relationType: 'exposure', status: 'research', note: '太极实业也可关联厂房与洁净室环节。' },
      { id: 'edge-asml-tsmc', graphId: 'graph-ai-server', sourceId: 'company-asml', targetId: 'company-tsmc', relationType: 'supplies', status: 'fact', note: 'ASML 向先进晶圆厂供应关键设备。' },
      { id: 'edge-tsmc-nvidia', graphId: 'graph-ai-server', sourceId: 'company-tsmc', targetId: 'company-nvidia', relationType: 'supplies', status: 'fact', note: '台积电为 NVIDIA 提供先进制程代工服务。' },
      { id: 'edge-cxmt-samsung', graphId: 'graph-ai-server', sourceId: 'company-cxmt', targetId: 'company-nvidia', relationType: 'competition', status: 'unverified', note: '用于展示未验证关系状态，后续应核验或删除。' },
      { id: 'edge-robot-model', graphId: 'graph-embodied-ai', sourceId: 'narrative-embodied-ai', targetId: 'concept-robot-foundation-model', relationType: 'contains', status: 'research', note: '具身智能大脑层。' },
      { id: 'edge-robot-body', graphId: 'graph-embodied-ai', sourceId: 'narrative-embodied-ai', targetId: 'concept-humanoid-body', relationType: 'contains', status: 'fact', note: '整机本体层。' },
      { id: 'edge-robot-actuator', graphId: 'graph-embodied-ai', sourceId: 'concept-humanoid-body', targetId: 'concept-actuator', relationType: 'contains', status: 'fact', note: '执行器是机器人本体关键部件。' },
      { id: 'edge-actuator-reducer', graphId: 'graph-embodied-ai', sourceId: 'concept-actuator', targetId: 'concept-reducer', relationType: 'upstream', status: 'fact', note: '减速器是执行器重要部件。' },
      { id: 'edge-robot-force-sensor', graphId: 'graph-embodied-ai', sourceId: 'concept-humanoid-body', targetId: 'concept-force-sensor', relationType: 'contains', status: 'research', note: '力控传感器提升机器人操作能力。' },
      { id: 'edge-robot-vision-sensor', graphId: 'graph-embodied-ai', sourceId: 'concept-humanoid-body', targetId: 'concept-vision-sensor', relationType: 'contains', status: 'research', note: '视觉传感器用于环境感知。' },
      { id: 'edge-nvidia-robot-model', graphId: 'graph-embodied-ai', sourceId: 'company-nvidia', targetId: 'concept-robot-foundation-model', relationType: 'supplies', status: 'research', note: '算力和平台能力与机器人模型相关。' },
      { id: 'edge-tesla-body', graphId: 'graph-embodied-ai', sourceId: 'company-tesla', targetId: 'concept-humanoid-body', relationType: 'produces', status: 'fact', note: 'Optimus 代表整机方向。' },
      { id: 'edge-top-actuator', graphId: 'graph-embodied-ai', sourceId: 'company-top-group', targetId: 'concept-actuator', relationType: 'exposure', status: 'research', note: '执行器相关产业暴露。' },
      { id: 'edge-harmonic-reducer', graphId: 'graph-embodied-ai', sourceId: 'company-harmonic', targetId: 'concept-reducer', relationType: 'produces', status: 'fact', note: '精密减速器相关。' },
      { id: 'edge-hesai-vision', graphId: 'graph-embodied-ai', sourceId: 'company-hesai', targetId: 'concept-vision-sensor', relationType: 'produces', status: 'research', note: '感知硬件相关。' },
      { id: 'edge-top-tesla', graphId: 'graph-embodied-ai', sourceId: 'company-top-group', targetId: 'company-tesla', relationType: 'supplies', status: 'unverified', note: '具身智能背景下的公司关系样例，待核验。' },
    ];

    for (const edge of edges) {
      insertEdge.run(edge.id, edge.graphId, edge.sourceId, edge.targetId, edge.relationType, edge.status || 'unverified', 1, edge.note || '', timestamp, timestamp);
    }

  });

  writeSeed();
}

/**
 * 获取 SQLite 连接，并在首次使用时初始化结构和样例数据。
 * @returns SQLite 数据库连接。
 */
function getDatabase(): Database.Database {
  if (database) {
    return database;
  }

  const databaseDirectory = dirname(DATABASE_PATH);
  if (!existsSync(databaseDirectory)) {
    mkdirSync(databaseDirectory, { recursive: true });
  }

  database = new Database(DATABASE_PATH);
  database.pragma('foreign_keys = ON');
  database.pragma('journal_mode = WAL');
  initializeSchema(database);
  seedInitialData(database);
  return database;
}

/**
 * 获取默认图谱 ID。
 * @param db SQLite 数据库连接。
 * @param requestedGraphId 请求中的图谱 ID。
 * @returns 当前图谱 ID。
 */
function resolveGraphId(db: Database.Database, requestedGraphId?: string): string {
  const cleanedGraphId = cleanText(requestedGraphId);
  if (cleanedGraphId) {
    assertGraphExists(db, cleanedGraphId);
    return cleanedGraphId;
  }

  const defaultGraph = db.prepare(`
    SELECT id FROM industry_graphs ORDER BY sort_order, label LIMIT 1
  `).get() as { id: string } | undefined;
  if (!defaultGraph) {
    throw new Error('没有可用的产业图谱');
  }
  return defaultGraph.id;
}

/**
 * 查询完整图谱快照。
 * @param requestedGraphId 指定产业图谱 ID。
 * @returns 当前产业图谱上下文中的快照。
 */
export function getGraphSnapshot(requestedGraphId?: string): GraphSnapshot {
  const db = getDatabase();
  const currentGraphId = resolveGraphId(db, requestedGraphId);
  const graphs = db
    .prepare('SELECT * FROM industry_graphs ORDER BY sort_order, label')
    .all() as GraphRow[];
  const lanes = db
    .prepare('SELECT * FROM lanes WHERE graph_id = ? ORDER BY sort_order, label')
    .all(currentGraphId) as LaneRow[];
  const nodes = db.prepare(`
    SELECT n.*, gn.lane_id, gn.sort_order
    FROM graph_nodes gn
    JOIN nodes n ON n.id = gn.node_id
    WHERE gn.graph_id = ?
    ORDER BY gn.sort_order, n.type, n.label
  `).all(currentGraphId) as NodeRow[];
  const edges = db
    .prepare('SELECT * FROM edges WHERE graph_id = ? ORDER BY relation_type, updated_at DESC')
    .all(currentGraphId) as EdgeRow[];
  return {
    graphs: graphs.map(mapGraph),
    currentGraphId,
    lanes: lanes.map(mapLane),
    nodes: nodes.map(mapNode),
    edges: edges.map(mapEdge),
  };
}

/**
 * 导出单个产业图谱完整 JSON 文档。
 * @param requestedGraphId 指定产业图谱 ID。
 * @returns 可用于恢复单个图谱的 JSON 文档。
 */
export function exportGraphDocument(requestedGraphId?: string): GraphExportDocument {
  const db = getDatabase();
  const graphId = resolveGraphId(db, requestedGraphId);
  const graphRow = db.prepare('SELECT * FROM industry_graphs WHERE id = ?').get(graphId) as GraphRow;
  const laneRows = db
    .prepare('SELECT * FROM lanes WHERE graph_id = ? ORDER BY sort_order, label')
    .all(graphId) as LaneRow[];
  const nodeRows = db.prepare(`
    SELECT n.*
    FROM graph_nodes gn
    JOIN nodes n ON n.id = gn.node_id
    WHERE gn.graph_id = ?
    ORDER BY gn.sort_order, n.type, n.label
  `).all(graphId) as NodeRow[];
  const membershipRows = db.prepare(`
    SELECT graph_id, node_id, lane_id, sort_order, created_at, updated_at
    FROM graph_nodes
    WHERE graph_id = ?
    ORDER BY sort_order, node_id
  `).all(graphId) as GraphNodeRow[];
  const edgeRows = db
    .prepare('SELECT * FROM edges WHERE graph_id = ? ORDER BY relation_type, updated_at DESC')
    .all(graphId) as EdgeRow[];

  return {
    schemaVersion: GRAPH_EXPORT_SCHEMA_VERSION,
    kind: GRAPH_EXPORT_KIND,
    exportedAt: nowIso(),
    graph: mapGraph(graphRow),
    lanes: laneRows.map(mapLane),
    nodes: nodeRows.map(mapExportNode),
    memberships: membershipRows.map(mapMembership),
    edges: edgeRows.map(mapEdge),
  };
}

/**
 * 导出适合外部编辑的单图谱 JSON 文档。
 * @param requestedGraphId 指定产业图谱 ID。
 * @returns 不包含内部 ID 和时间字段的可编辑图谱文档。
 */
export function exportGraphAuthoringDocument(requestedGraphId?: string): GraphAuthoringDocument {
  const db = getDatabase();
  const graphId = resolveGraphId(db, requestedGraphId);
  const graphRow = db.prepare('SELECT * FROM industry_graphs WHERE id = ?').get(graphId) as GraphRow;
  const laneRows = db
    .prepare('SELECT * FROM lanes WHERE graph_id = ? ORDER BY sort_order, label')
    .all(graphId) as LaneRow[];
  const nodeRows = db.prepare(`
    SELECT n.*, gn.lane_id, gn.sort_order
    FROM graph_nodes gn
    JOIN nodes n ON n.id = gn.node_id
    WHERE gn.graph_id = ?
    ORDER BY gn.sort_order, n.type, n.label
  `).all(graphId) as NodeRow[];
  const edgeRows = db
    .prepare('SELECT * FROM edges WHERE graph_id = ? ORDER BY relation_type, updated_at DESC')
    .all(graphId) as EdgeRow[];
  const laneById = new Map(laneRows.map((lane) => [lane.id, lane]));
  const nodeById = new Map(nodeRows.map((node) => [node.id, node]));
  const nodeReferenceById = new Map(nodeRows.map((node) => [node.id, createDefaultNodeReference(mapExportNode(node))]));

  return {
    schemaVersion: GRAPH_AUTHORING_SCHEMA_VERSION,
    kind: GRAPH_AUTHORING_KIND,
    graph: {
      label: graphRow.label,
      summary: graphRow.summary || '',
      sortOrder: graphRow.sort_order,
    },
    lanes: laneRows.map((lane) => ({
      label: lane.label,
      color: lane.color,
      order: lane.sort_order,
    })),
    nodes: nodeRows.map((node) => ({
      type: node.type,
      label: node.label,
      weightTier: node.weight_tier,
      lane: node.lane_id ? laneById.get(node.lane_id)?.label || '' : '',
      order: node.sort_order || 0,
      summary: node.summary || '',
      ticker: node.ticker || '',
      market: node.market || '',
    })),
    edges: edgeRows.map((edge) => ({
      from: nodeReferenceById.get(edge.source_id) || nodeById.get(edge.source_id)?.label || edge.source_id,
      to: nodeReferenceById.get(edge.target_id) || nodeById.get(edge.target_id)?.label || edge.target_id,
      relationType: edge.relation_type,
      status: edge.status,
      weight: edge.weight,
      note: edge.note || '',
    })),
  };
}

/**
 * 读取导入文档中的图谱对象。
 * @param value 原始 JSON 值。
 * @param path 字段路径。
 * @param issues 字段级错误列表。
 * @returns 标准化后的图谱对象。
 */
function readImportGraph(
  value: unknown,
  path: string,
  issues: GraphImportValidationIssue[]
): IndustryGraph {
  const record = readRecord(value, path, issues);
  return {
    id: readNonEmptyStringField(record, path, 'id', issues),
    label: readNonEmptyStringField(record, path, 'label', issues),
    summary: readStringField(record, path, 'summary', issues),
    sortOrder: readNumberField(record, path, 'sortOrder', issues),
    createdAt: readNonEmptyStringField(record, path, 'createdAt', issues),
    updatedAt: readNonEmptyStringField(record, path, 'updatedAt', issues),
  };
}

/**
 * 读取导入文档中的泳道对象。
 * @param value 原始 JSON 值。
 * @param path 字段路径。
 * @param issues 字段级错误列表。
 * @returns 标准化后的泳道对象。
 */
function readImportLane(
  value: unknown,
  path: string,
  issues: GraphImportValidationIssue[]
): ResearchLane {
  const record = readRecord(value, path, issues);
  return {
    id: readNonEmptyStringField(record, path, 'id', issues),
    graphId: readNonEmptyStringField(record, path, 'graphId', issues),
    label: readNonEmptyStringField(record, path, 'label', issues),
    color: readNonEmptyStringField(record, path, 'color', issues),
    sortOrder: readNumberField(record, path, 'sortOrder', issues),
    createdAt: readNonEmptyStringField(record, path, 'createdAt', issues),
    updatedAt: readNonEmptyStringField(record, path, 'updatedAt', issues),
  };
}

/**
 * 规范化导入节点的上市字段。
 * @param nodeType 节点类型。
 * @param market 市场名称。
 * @param ticker 证券代码。
 * @param path 字段路径。
 * @param issues 字段级错误列表。
 * @returns 标准化后的上市字段。
 */
function normalizeImportListingFields(
  nodeType: ResearchNodeType,
  market: string,
  ticker: string,
  path: string,
  issues: GraphImportValidationIssue[]
): { market: string; ticker: string } {
  if (nodeType !== 'company') {
    if (market || ticker) {
      addImportIssue(issues, path, '非公司节点不能填写 market 或 ticker');
    }
    return { market: '', ticker: '' };
  }

  try {
    return prepareNodeListingFields(nodeType, market, ticker);
  } catch (error) {
    addImportIssue(issues, `${path}.ticker`, error instanceof Error ? error.message : '证券代码无效');
    return { market, ticker };
  }
}

/**
 * 读取导入文档中的节点对象。
 * @param value 原始 JSON 值。
 * @param path 字段路径。
 * @param issues 字段级错误列表。
 * @returns 标准化后的节点对象。
 */
function readImportNode(
  value: unknown,
  path: string,
  issues: GraphImportValidationIssue[]
): GraphExportNode {
  const record = readRecord(value, path, issues);
  const nodeType = readEnumField(record, path, 'type', NODE_TYPES, 'concept', issues) as ResearchNodeType;
  const market = readStringField(record, path, 'market', issues);
  const ticker = readStringField(record, path, 'ticker', issues);
  const listingFields = normalizeImportListingFields(nodeType, market, ticker, path, issues);
  return {
    id: readNonEmptyStringField(record, path, 'id', issues),
    type: nodeType,
    label: readNonEmptyStringField(record, path, 'label', issues),
    weightTier: readEnumField(record, path, 'weightTier', NODE_WEIGHT_TIERS, 'medium', issues) as NodeWeightTier,
    summary: readStringField(record, path, 'summary', issues),
    ticker: listingFields.ticker,
    market: listingFields.market,
    createdAt: readNonEmptyStringField(record, path, 'createdAt', issues),
    updatedAt: readNonEmptyStringField(record, path, 'updatedAt', issues),
  };
}

/**
 * 读取导入文档中的图谱节点归属对象。
 * @param value 原始 JSON 值。
 * @param path 字段路径。
 * @param issues 字段级错误列表。
 * @returns 标准化后的图谱节点归属对象。
 */
function readImportMembership(
  value: unknown,
  path: string,
  issues: GraphImportValidationIssue[]
): GraphNodeMembership {
  const record = readRecord(value, path, issues);
  return {
    graphId: readNonEmptyStringField(record, path, 'graphId', issues),
    nodeId: readNonEmptyStringField(record, path, 'nodeId', issues),
    laneId: readStringField(record, path, 'laneId', issues),
    sortOrder: readNumberField(record, path, 'sortOrder', issues),
    createdAt: readNonEmptyStringField(record, path, 'createdAt', issues),
    updatedAt: readNonEmptyStringField(record, path, 'updatedAt', issues),
  };
}

/**
 * 读取导入文档中的关系对象。
 * @param value 原始 JSON 值。
 * @param path 字段路径。
 * @param issues 字段级错误列表。
 * @returns 标准化后的关系对象。
 */
function readImportEdge(
  value: unknown,
  path: string,
  issues: GraphImportValidationIssue[]
): ResearchEdge {
  const record = readRecord(value, path, issues);
  return {
    id: readNonEmptyStringField(record, path, 'id', issues),
    graphId: readNonEmptyStringField(record, path, 'graphId', issues),
    sourceId: readNonEmptyStringField(record, path, 'sourceId', issues),
    targetId: readNonEmptyStringField(record, path, 'targetId', issues),
    relationType: readEnumField(record, path, 'relationType', RELATION_TYPES, 'contains', issues) as RelationType,
    status: readEnumField(record, path, 'status', EDGE_STATUSES, 'unverified', issues) as EdgeStatus,
    weight: readNumberField(record, path, 'weight', issues),
    note: readStringField(record, path, 'note', issues),
    createdAt: readNonEmptyStringField(record, path, 'createdAt', issues),
    updatedAt: readNonEmptyStringField(record, path, 'updatedAt', issues),
  };
}

/**
 * 读取外部书写格式中的图谱对象。
 * @param value 原始 JSON 值。
 * @param path 字段路径。
 * @param issues 字段级错误列表。
 * @returns 外部图谱对象。
 */
function readAuthoringGraph(
  value: unknown,
  path: string,
  issues: GraphImportValidationIssue[]
): GraphAuthoringDocument['graph'] {
  const record = readRecord(value, path, issues);
  return {
    label: readNonEmptyStringField(record, path, 'label', issues),
    summary: typeof record.summary === 'undefined' ? '' : readStringField(record, path, 'summary', issues),
    sortOrder: typeof record.sortOrder === 'undefined' ? undefined : readNumberField(record, path, 'sortOrder', issues),
  };
}

/**
 * 读取外部书写格式中的泳道对象。
 * @param value 原始 JSON 值。
 * @param path 字段路径。
 * @param index 泳道序号。
 * @param issues 字段级错误列表。
 * @returns 外部泳道对象。
 */
function readAuthoringLane(
  value: unknown,
  path: string,
  index: number,
  issues: GraphImportValidationIssue[]
): GraphAuthoringLane {
  const record = readRecord(value, path, issues);
  return {
    label: readNonEmptyStringField(record, path, 'label', issues),
    color: typeof record.color === 'undefined' ? '#2563eb' : readNonEmptyStringField(record, path, 'color', issues),
    order: typeof record.order === 'undefined' ? (index + 1) * 10 : readNumberField(record, path, 'order', issues),
  };
}

/**
 * 读取外部书写格式中的节点对象。
 * @param value 原始 JSON 值。
 * @param path 字段路径。
 * @param index 节点序号。
 * @param issues 字段级错误列表。
 * @returns 外部节点对象。
 */
function readAuthoringNode(
  value: unknown,
  path: string,
  index: number,
  issues: GraphImportValidationIssue[]
): GraphAuthoringNode {
  const record = readRecord(value, path, issues);
  const nodeType = readEnumField(record, path, 'type', NODE_TYPES, 'concept', issues) as ResearchNodeType;
  const rawMarket = typeof record.market === 'undefined' ? '' : readStringField(record, path, 'market', issues);
  const rawTicker = typeof record.ticker === 'undefined' ? '' : readStringField(record, path, 'ticker', issues);
  const listingFields = normalizeImportListingFields(nodeType, rawMarket, rawTicker, path, issues);
  return {
    type: nodeType,
    label: readNonEmptyStringField(record, path, 'label', issues),
    weightTier: typeof record.weightTier === 'undefined'
      ? 'medium'
      : readEnumField(record, path, 'weightTier', NODE_WEIGHT_TIERS, 'medium', issues) as NodeWeightTier,
    lane: typeof record.lane === 'undefined' ? '' : readStringField(record, path, 'lane', issues),
    order: typeof record.order === 'undefined' ? (index + 1) * 10 : readNumberField(record, path, 'order', issues),
    summary: typeof record.summary === 'undefined' ? '' : readStringField(record, path, 'summary', issues),
    ticker: listingFields.ticker,
    market: listingFields.market,
  };
}

/**
 * 读取外部书写格式中的关系对象。
 * @param value 原始 JSON 值。
 * @param path 字段路径。
 * @param issues 字段级错误列表。
 * @returns 外部关系对象。
 */
function readAuthoringEdge(
  value: unknown,
  path: string,
  issues: GraphImportValidationIssue[]
): GraphAuthoringEdge {
  const record = readRecord(value, path, issues);
  return {
    from: readNonEmptyStringField(record, path, 'from', issues),
    to: readNonEmptyStringField(record, path, 'to', issues),
    relationType: readEnumField(record, path, 'relationType', RELATION_TYPES, 'contains', issues) as RelationType,
    status: typeof record.status === 'undefined'
      ? 'unverified'
      : readEnumField(record, path, 'status', EDGE_STATUSES, 'unverified', issues) as EdgeStatus,
    weight: typeof record.weight === 'undefined' ? 1 : readNumberField(record, path, 'weight', issues),
    note: typeof record.note === 'undefined' ? '' : readStringField(record, path, 'note', issues),
  };
}

/**
 * 根据节点唯一键查找已有节点。
 * @param db SQLite 数据库连接。
 * @param node 节点实体。
 * @returns 已存在的节点行。
 */
function findExistingNodeByIdentity(db: Database.Database, node: GraphExportNode): NodeRow | undefined {
  if (node.type === 'company' && node.market && node.ticker) {
    return db.prepare(`
      SELECT * FROM nodes
      WHERE type = 'company' AND market = ? AND ticker = ?
      LIMIT 1
    `).get(node.market, node.ticker) as NodeRow | undefined;
  }

  return db.prepare(`
    SELECT * FROM nodes
    WHERE type = ? AND label = ?
    LIMIT 1
  `).get(node.type, node.label) as NodeRow | undefined;
}

/**
 * 查询同名图谱。
 * @param db SQLite 数据库连接。
 * @param graphLabel 图谱名称。
 * @returns 同名图谱列表。
 */
function findGraphsByLabel(db: Database.Database, graphLabel: string): GraphRow[] {
  return db.prepare('SELECT * FROM industry_graphs WHERE label = ? ORDER BY created_at').all(graphLabel) as GraphRow[];
}

/**
 * 解析外部节点引用。
 * @param reference 外部引用文本。
 * @param nodeIdByReference 引用到节点 ID 的索引。
 * @returns 节点 ID。
 */
function resolveAuthoringNodeReference(reference: string, nodeIdByReference: Map<string, string>): string {
  return nodeIdByReference.get(reference) || '';
}

/**
 * 添加节点引用索引。
 * @param node 导入节点。
 * @param nodeId 节点 ID。
 * @param nodeIdByReference 引用到节点 ID 的索引。
 * @param ambiguousReferences 有歧义的引用集合。
 */
function indexAuthoringNodeReferences(
  node: GraphExportNode,
  nodeId: string,
  nodeIdByReference: Map<string, string>,
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
    const existingNodeId = nodeIdByReference.get(reference);
    if (existingNodeId && existingNodeId !== nodeId) {
      nodeIdByReference.delete(reference);
      ambiguousReferences.add(reference);
      continue;
    }
    nodeIdByReference.set(reference, nodeId);
  }
}

/**
 * 将外部书写格式转换为内部导入文档。
 * @param value 原始 JSON 值。
 * @param db SQLite 数据库连接。
 * @returns 内部导入文档。
 */
function convertAuthoringDocumentToGraphExportDocument(
  value: unknown,
  db: Database.Database
): ValidatedGraphExportDocument {
  const issues: GraphImportValidationIssue[] = [];
  const documentRecord = readRecord(value, '$', issues);
  if (documentRecord.schemaVersion !== GRAPH_AUTHORING_SCHEMA_VERSION) {
    addImportIssue(issues, '$.schemaVersion', `必须是 ${GRAPH_AUTHORING_SCHEMA_VERSION}`);
  }
  if (documentRecord.kind !== GRAPH_AUTHORING_KIND) {
    addImportIssue(issues, '$.kind', `必须是 ${GRAPH_AUTHORING_KIND}`);
  }

  const timestamp = nowIso();
  const graphInput = readAuthoringGraph(documentRecord.graph, '$.graph', issues);
  const existingGraphs = graphInput.label ? findGraphsByLabel(db, graphInput.label) : [];
  if (existingGraphs.length > 1) {
    addImportIssue(issues, '$.graph.label', `数据库中存在多个同名图谱，无法确定导入目标: ${graphInput.label}`);
  }
  const existingGraph = existingGraphs[0];
  const graphId = existingGraph?.id || createStableGraphId(graphInput.label);
  const graph: IndustryGraph = {
    id: graphId,
    label: graphInput.label,
    summary: graphInput.summary || '',
    sortOrder: graphInput.sortOrder ?? existingGraph?.sort_order ?? 0,
    createdAt: existingGraph?.created_at || timestamp,
    updatedAt: timestamp,
  };

  const laneLabels = new Set<string>();
  const laneIdByLabel = new Map<string, string>();
  const lanes = readArrayField(documentRecord, '$', 'lanes', issues).map((item, index) => {
    const path = `$.lanes[${index}]`;
    const laneInput = readAuthoringLane(item, path, index, issues);
    if (laneLabels.has(laneInput.label)) {
      addImportIssue(issues, `${path}.label`, `泳道名称重复: ${laneInput.label}`);
    }
    laneLabels.add(laneInput.label);
    const laneId = createStableLaneId(graph.label, laneInput.label);
    laneIdByLabel.set(laneInput.label, laneId);
    return {
      id: laneId,
      graphId,
      label: laneInput.label,
      color: laneInput.color || '#2563eb',
      sortOrder: readOptionalNumber(laneInput.order, (index + 1) * 10),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });

  const nodeIdentityKeys = new Set<string>();
  const nodeIdByReference = new Map<string, string>();
  const ambiguousReferences = new Set<string>();
  const memberships: GraphNodeMembership[] = [];
  const nodes = readArrayField(documentRecord, '$', 'nodes', issues).map((item, index) => {
    const path = `$.nodes[${index}]`;
    const nodeInput = readAuthoringNode(item, path, index, issues);
    if (nodeInput.lane && !laneIdByLabel.has(nodeInput.lane)) {
      addImportIssue(issues, `${path}.lane`, `泳道不存在: ${nodeInput.lane}`);
    }

    const candidateNode: GraphExportNode = {
      id: createStableNodeId(nodeInput.type, nodeInput.label, nodeInput.market || '', nodeInput.ticker || ''),
      type: nodeInput.type,
      label: nodeInput.label,
      weightTier: nodeInput.weightTier || 'medium',
      summary: nodeInput.summary || '',
      ticker: nodeInput.ticker || '',
      market: nodeInput.market || '',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const identityKey = createNodeIdentityKey(candidateNode);
    if (nodeIdentityKeys.has(identityKey)) {
      addImportIssue(issues, path, `节点唯一键重复: ${nodeInput.type} / ${nodeInput.label}`);
    }
    nodeIdentityKeys.add(identityKey);

    const existingNode = findExistingNodeByIdentity(db, candidateNode);
    const node: GraphExportNode = {
      ...candidateNode,
      id: existingNode?.id || candidateNode.id,
      createdAt: existingNode?.created_at || candidateNode.createdAt,
      updatedAt: timestamp,
    };

    memberships.push({
      graphId,
      nodeId: node.id,
      laneId: nodeInput.lane ? laneIdByLabel.get(nodeInput.lane) || '' : '',
      sortOrder: readOptionalNumber(nodeInput.order, (index + 1) * 10),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    indexAuthoringNodeReferences(node, node.id, nodeIdByReference, ambiguousReferences);
    return node;
  });

  const edgeRelationKeys = new Set<string>();
  const edges = readArrayField(documentRecord, '$', 'edges', issues).map((item, index) => {
    const path = `$.edges[${index}]`;
    const edgeInput = readAuthoringEdge(item, path, issues);
    const sourceId = resolveAuthoringNodeReference(edgeInput.from, nodeIdByReference);
    const targetId = resolveAuthoringNodeReference(edgeInput.to, nodeIdByReference);
    if (!sourceId) {
      const message = ambiguousReferences.has(edgeInput.from) ? '来源节点引用有歧义，请使用 type:label 或 company:label:market:ticker' : `来源节点不存在: ${edgeInput.from}`;
      addImportIssue(issues, `${path}.from`, message);
    }
    if (!targetId) {
      const message = ambiguousReferences.has(edgeInput.to) ? '目标节点引用有歧义，请使用 type:label 或 company:label:market:ticker' : `目标节点不存在: ${edgeInput.to}`;
      addImportIssue(issues, `${path}.to`, message);
    }
    if (sourceId && sourceId === targetId) {
      addImportIssue(issues, `${path}.to`, '关系不能连接到同一个节点');
    }

    const relationKey = `${sourceId}\u0000${targetId}\u0000${edgeInput.relationType}`;
    if (edgeRelationKeys.has(relationKey)) {
      addImportIssue(issues, path, '同一图谱中 from、to 和 relationType 不能重复');
    }
    edgeRelationKeys.add(relationKey);

    return {
      id: createStableEdgeId(graph.label, sourceId || edgeInput.from, targetId || edgeInput.to, edgeInput.relationType),
      graphId,
      sourceId,
      targetId,
      relationType: edgeInput.relationType,
      status: edgeInput.status || 'unverified',
      weight: readOptionalNumber(edgeInput.weight, 1),
      note: edgeInput.note || '',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });

  const document: ValidatedGraphExportDocument = {
    schemaVersion: GRAPH_EXPORT_SCHEMA_VERSION,
    kind: GRAPH_EXPORT_KIND,
    exportedAt: timestamp,
    graph,
    lanes,
    nodes,
    memberships,
    edges,
  };

  checkImportDatabaseConflicts(db, document, issues, { checkSharedNodeContent: false });

  if (issues.length > 0) {
    throw new GraphImportValidationError(issues);
  }

  return document;
}

/**
 * 比较导入节点和数据库节点实体是否一致。
 * @param importedNode 导入节点。
 * @param existingNode 数据库节点。
 * @returns 节点实体内容是否一致。
 */
function isSameNodeEntity(importedNode: GraphExportNode, existingNode: NodeRow): boolean {
  return importedNode.type === existingNode.type
    && importedNode.label === existingNode.label
    && importedNode.weightTier === existingNode.weight_tier
    && importedNode.summary === (existingNode.summary || '')
    && importedNode.ticker === (existingNode.ticker || '')
    && importedNode.market === (existingNode.market || '')
    && importedNode.createdAt === existingNode.created_at
    && importedNode.updatedAt === existingNode.updated_at;
}

/**
 * 检查导入文档与现有数据库的跨图谱冲突。
 * @param db SQLite 数据库连接。
 * @param document 标准化后的导入文档。
 * @param issues 字段级错误列表。
 */
function checkImportDatabaseConflicts(
  db: Database.Database,
  document: GraphExportDocument,
  issues: GraphImportValidationIssue[],
  options: { checkSharedNodeContent: boolean } = { checkSharedNodeContent: true }
): void {
  const graphId = document.graph.id;
  const existingLaneQuery = db.prepare('SELECT graph_id FROM lanes WHERE id = ? AND graph_id <> ? LIMIT 1');
  const existingEdgeQuery = db.prepare('SELECT graph_id FROM edges WHERE id = ? AND graph_id <> ? LIMIT 1');
  const existingNodeQuery = db.prepare('SELECT * FROM nodes WHERE id = ?');
  const otherNodeUsageQuery = db.prepare('SELECT graph_id FROM graph_nodes WHERE node_id = ? AND graph_id <> ? LIMIT 1');

  document.lanes.forEach((lane, index) => {
    const conflict = existingLaneQuery.get(lane.id, graphId) as { graph_id: string } | undefined;
    if (conflict) {
      addImportIssue(issues, `$.lanes[${index}].id`, `泳道 ID 已被其他图谱使用: ${conflict.graph_id}`);
    }
  });

  document.nodes.forEach((node, index) => {
    const existingNode = existingNodeQuery.get(node.id) as NodeRow | undefined;
    const otherUsage = otherNodeUsageQuery.get(node.id, graphId) as { graph_id: string } | undefined;
    if (options.checkSharedNodeContent && existingNode && otherUsage && !isSameNodeEntity(node, existingNode)) {
      addImportIssue(
        issues,
        `$.nodes[${index}].id`,
        `节点已被其他图谱使用且内容不一致: ${otherUsage.graph_id}`
      );
    }
  });

  document.edges.forEach((edge, index) => {
    const conflict = existingEdgeQuery.get(edge.id, graphId) as { graph_id: string } | undefined;
    if (conflict) {
      addImportIssue(issues, `$.edges[${index}].id`, `关系 ID 已被其他图谱使用: ${conflict.graph_id}`);
    }
  });
}

/**
 * 校验并标准化导入 JSON 文档。
 * @param value 原始 JSON 值。
 * @param db SQLite 数据库连接。
 * @returns 标准化后的导入文档。
 */
function validateGraphImportDocument(value: unknown, db: Database.Database): ValidatedGraphExportDocument {
  const issues: GraphImportValidationIssue[] = [];
  const documentRecord = readRecord(value, '$', issues);

  if (documentRecord.schemaVersion !== GRAPH_EXPORT_SCHEMA_VERSION) {
    addImportIssue(issues, '$.schemaVersion', `必须是 ${GRAPH_EXPORT_SCHEMA_VERSION}`);
  }
  if (documentRecord.kind !== GRAPH_EXPORT_KIND) {
    addImportIssue(issues, '$.kind', `必须是 ${GRAPH_EXPORT_KIND}`);
  }

  const exportedAt = readNonEmptyStringField(documentRecord, '$', 'exportedAt', issues);
  const graph = readImportGraph(documentRecord.graph, '$.graph', issues);
  const graphId = graph.id;
  if (graph.id && graph.label) {
    const graphLabelConflict = db.prepare(`
      SELECT id FROM industry_graphs
      WHERE label = ? AND id <> ?
      LIMIT 1
    `).get(graph.label, graph.id) as { id: string } | undefined;
    if (graphLabelConflict) {
      addImportIssue(issues, '$.graph.label', `图谱名称已被其他图谱使用: ${graphLabelConflict.id}`);
    }
  }
  const laneIds = new Set<string>();
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const membershipNodeIds = new Set<string>();
  const edgeRelationKeys = new Set<string>();

  const lanes = readArrayField(documentRecord, '$', 'lanes', issues).map((item, index) => {
    const path = `$.lanes[${index}]`;
    const lane = readImportLane(item, path, issues);
    assertUniqueId(lane.id, `${path}.id`, laneIds, issues);
    if (lane.graphId !== graphId) {
      addImportIssue(issues, `${path}.graphId`, `必须等于 graph.id: ${graphId}`);
    }
    return lane;
  });

  const nodes = readArrayField(documentRecord, '$', 'nodes', issues).map((item, index) => {
    const path = `$.nodes[${index}]`;
    const node = readImportNode(item, path, issues);
    assertUniqueId(node.id, `${path}.id`, nodeIds, issues);
    return node;
  });

  const memberships = readArrayField(documentRecord, '$', 'memberships', issues).map((item, index) => {
    const path = `$.memberships[${index}]`;
    const membership = readImportMembership(item, path, issues);
    if (membership.graphId !== graphId) {
      addImportIssue(issues, `${path}.graphId`, `必须等于 graph.id: ${graphId}`);
    }
    if (!nodeIds.has(membership.nodeId)) {
      addImportIssue(issues, `${path}.nodeId`, `节点不存在: ${membership.nodeId}`);
    }
    if (membership.laneId && !laneIds.has(membership.laneId)) {
      addImportIssue(issues, `${path}.laneId`, `泳道不存在: ${membership.laneId}`);
    }
    assertUniqueId(membership.nodeId, `${path}.nodeId`, membershipNodeIds, issues);
    return membership;
  });

  nodes.forEach((node, index) => {
    if (!membershipNodeIds.has(node.id)) {
      addImportIssue(issues, `$.nodes[${index}].id`, '节点必须在 memberships 中出现一次');
    }
  });

  const edges = readArrayField(documentRecord, '$', 'edges', issues).map((item, index) => {
    const path = `$.edges[${index}]`;
    const edge = readImportEdge(item, path, issues);
    assertUniqueId(edge.id, `${path}.id`, edgeIds, issues);
    if (edge.graphId !== graphId) {
      addImportIssue(issues, `${path}.graphId`, `必须等于 graph.id: ${graphId}`);
    }
    if (!nodeIds.has(edge.sourceId)) {
      addImportIssue(issues, `${path}.sourceId`, `来源节点不存在: ${edge.sourceId}`);
    }
    if (!nodeIds.has(edge.targetId)) {
      addImportIssue(issues, `${path}.targetId`, `目标节点不存在: ${edge.targetId}`);
    }
    if (edge.sourceId && edge.sourceId === edge.targetId) {
      addImportIssue(issues, `${path}.targetId`, '关系不能连接到同一个节点');
    }

    const edgeRelationKey = `${edge.sourceId}\u0000${edge.targetId}\u0000${edge.relationType}`;
    if (edgeRelationKeys.has(edgeRelationKey)) {
      addImportIssue(issues, path, '同一图谱中 sourceId、targetId 和 relationType 不能重复');
    } else {
      edgeRelationKeys.add(edgeRelationKey);
    }
    return edge;
  });

  const document: ValidatedGraphExportDocument = {
    schemaVersion: GRAPH_EXPORT_SCHEMA_VERSION,
    kind: GRAPH_EXPORT_KIND,
    exportedAt,
    graph,
    lanes,
    nodes,
    memberships,
    edges,
  };

  checkImportDatabaseConflicts(db, document, issues);

  if (issues.length > 0) {
    throw new GraphImportValidationError(issues);
  }

  return document;
}

/**
 * 导入单个产业图谱 JSON 文档。
 * @param payload 已解析的 JSON 值。
 * @returns 导入结果摘要。
 */
export function importGraphDocument(payload: unknown): GraphImportResult {
  const db = getDatabase();
  const payloadRecord = isRecord(payload) ? payload : {};
  const document = payloadRecord.kind === GRAPH_AUTHORING_KIND
    ? convertAuthoringDocumentToGraphExportDocument(payload, db)
    : validateGraphImportDocument(payload, db);
  const graphId = document.graph.id;
  const existingGraph = db.prepare('SELECT id FROM industry_graphs WHERE id = ?').get(graphId);
  const oldNodeRows = db
    .prepare('SELECT node_id FROM graph_nodes WHERE graph_id = ?')
    .all(graphId) as Array<{ node_id: string }>;
  const importNodeIds = new Set(document.nodes.map((node) => node.id));

  const writeGraphDocument = db.transaction(() => {
    db.prepare(`
      INSERT INTO industry_graphs (id, label, summary, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        summary = excluded.summary,
        sort_order = excluded.sort_order,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run(
      graphId,
      document.graph.label,
      document.graph.summary,
      document.graph.sortOrder,
      document.graph.createdAt,
      document.graph.updatedAt
    );

    db.prepare('DELETE FROM edges WHERE graph_id = ?').run(graphId);
    db.prepare('DELETE FROM graph_nodes WHERE graph_id = ?').run(graphId);
    db.prepare('DELETE FROM lanes WHERE graph_id = ?').run(graphId);

    const nodeStillUsedQuery = db.prepare('SELECT node_id FROM graph_nodes WHERE node_id = ? LIMIT 1');
    const deleteNodeQuery = db.prepare('DELETE FROM nodes WHERE id = ?');
    for (const oldNodeRow of oldNodeRows) {
      const isStillUsed = nodeStillUsedQuery.get(oldNodeRow.node_id);
      if (!isStillUsed && !importNodeIds.has(oldNodeRow.node_id)) {
        deleteNodeQuery.run(oldNodeRow.node_id);
      }
    }

    const upsertNode = db.prepare(`
      INSERT INTO nodes (id, type, label, weight_tier, summary, ticker, market, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        label = excluded.label,
        weight_tier = excluded.weight_tier,
        summary = excluded.summary,
        ticker = excluded.ticker,
        market = excluded.market,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `);
    for (const node of document.nodes) {
      upsertNode.run(
        node.id,
        node.type,
        node.label,
        node.weightTier,
        node.summary,
        node.ticker,
        node.market,
        node.createdAt,
        node.updatedAt
      );
    }

    const insertLane = db.prepare(`
      INSERT INTO lanes (id, graph_id, label, color, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const lane of document.lanes) {
      insertLane.run(
        lane.id,
        lane.graphId,
        lane.label,
        lane.color,
        lane.sortOrder,
        lane.createdAt,
        lane.updatedAt
      );
    }

    const insertMembership = db.prepare(`
      INSERT INTO graph_nodes (graph_id, node_id, lane_id, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const membership of document.memberships) {
      insertMembership.run(
        membership.graphId,
        membership.nodeId,
        membership.laneId || null,
        membership.sortOrder,
        membership.createdAt,
        membership.updatedAt
      );
    }

    const insertEdge = db.prepare(`
      INSERT INTO edges (id, graph_id, source_id, target_id, relation_type, status, weight, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const edge of document.edges) {
      insertEdge.run(
        edge.id,
        edge.graphId,
        edge.sourceId,
        edge.targetId,
        edge.relationType,
        edge.status,
        edge.weight,
        edge.note,
        edge.createdAt,
        edge.updatedAt
      );
    }
  });

  writeGraphDocument();

  return {
    graphId,
    graphLabel: document.graph.label,
    created: !existingGraph,
    lanes: document.lanes.length,
    nodes: document.nodes.length,
    memberships: document.memberships.length,
    edges: document.edges.length,
  };
}

/**
 * 创建产业图谱。
 * @param input 图谱输入信息。
 * @returns 创建后的产业图谱。
 */
export function createGraph(input: GraphInput): IndustryGraph {
  const db = getDatabase();
  const label = cleanText(input.label);
  if (!label) {
    throw new Error('图谱名称不能为空');
  }
  const existingGraph = db.prepare('SELECT id FROM industry_graphs WHERE label = ? LIMIT 1').get(label);
  if (existingGraph) {
    throw new Error(`图谱名称已存在: ${label}`);
  }

  const timestamp = nowIso();
  const id = randomUUID();
  const maxSortRow = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS maxSortOrder FROM industry_graphs')
    .get() as { maxSortOrder: number };
  const sortOrder = maxSortRow.maxSortOrder + 10;
  db.prepare(`
    INSERT INTO industry_graphs (id, label, summary, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, label, cleanText(input.summary), sortOrder, timestamp, timestamp);

  const row = db.prepare('SELECT * FROM industry_graphs WHERE id = ?').get(id) as GraphRow;
  return mapGraph(row);
}

/**
 * 删除产业图谱，并清理不再被任何图谱引用的节点。
 * @param id 图谱 ID。
 * @returns 是否删除了记录。
 */
export function deleteGraph(id: string): boolean {
  const db = getDatabase();
  const graphId = cleanText(id);
  if (!graphId) {
    throw new Error('图谱 ID 不能为空');
  }

  const existingGraph = db.prepare('SELECT id FROM industry_graphs WHERE id = ?').get(graphId);
  if (!existingGraph) {
    return false;
  }

  const graphCount = db.prepare('SELECT COUNT(*) AS count FROM industry_graphs').get() as { count: number };
  if (graphCount.count <= 1) {
    throw new Error('至少保留一个产业图谱');
  }

  const deleteGraphTransaction = db.transaction(() => {
    const memberRows = db
      .prepare('SELECT node_id FROM graph_nodes WHERE graph_id = ?')
      .all(graphId) as Array<{ node_id: string }>;
    const result = db.prepare('DELETE FROM industry_graphs WHERE id = ?').run(graphId);
    if (result.changes === 0) {
      return false;
    }

    const nodeStillUsedQuery = db.prepare('SELECT node_id FROM graph_nodes WHERE node_id = ? LIMIT 1');
    const deleteNodeQuery = db.prepare('DELETE FROM nodes WHERE id = ?');
    memberRows.forEach((memberRow) => {
      const stillUsed = nodeStillUsedQuery.get(memberRow.node_id);
      if (!stillUsed) {
        deleteNodeQuery.run(memberRow.node_id);
      }
    });
    return true;
  });

  return deleteGraphTransaction();
}

/**
 * 新增产业链泳道。
 * @param input 泳道输入信息。
 * @returns 创建后的泳道。
 */
export function createLane(input: LaneInput): ResearchLane {
  const db = getDatabase();
  const graphId = cleanText(input.graphId);
  if (!graphId) {
    throw new Error('新增泳道必须指定产业图谱');
  }
  assertGraphExists(db, graphId);

  const label = cleanText(input.label);
  if (!label) {
    throw new Error('泳道名称不能为空');
  }

  const timestamp = nowIso();
  const id = randomUUID();
  const color = cleanText(input.color, '#2563eb');
  const maxSortRow = db.prepare(`
    SELECT COALESCE(MAX(sort_order), 0) AS maxSortOrder
    FROM lanes
    WHERE graph_id = ?
  `).get(graphId) as { maxSortOrder: number };
  const sortOrder = maxSortRow.maxSortOrder + 10;
  db.prepare(`
    INSERT INTO lanes (id, graph_id, label, color, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, graphId, label, color, sortOrder, timestamp, timestamp);

  const row = db.prepare('SELECT * FROM lanes WHERE id = ?').get(id) as LaneRow;
  return mapLane(row);
}

/**
 * 更新产业链泳道。
 * @param id 泳道 ID。
 * @param input 泳道更新字段。
 * @returns 更新后的泳道。
 */
export function updateLane(id: string, input: Partial<LaneInput>): ResearchLane {
  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM lanes WHERE id = ?').get(id) as LaneRow | undefined;
  if (!existing) {
    throw new Error(`泳道不存在: ${id}`);
  }

  const label = input.label === undefined ? existing.label : cleanText(input.label);
  if (!label) {
    throw new Error('泳道名称不能为空');
  }
  const color = input.color === undefined ? existing.color : cleanText(input.color, '#2563eb');
  const sortOrder = input.sortOrder === undefined
    ? existing.sort_order
    : Number.isFinite(input.sortOrder)
      ? Number(input.sortOrder)
      : existing.sort_order;
  const timestamp = nowIso();

  db.prepare(`
    UPDATE lanes
    SET label = ?, color = ?, sort_order = ?, updated_at = ?
    WHERE id = ?
  `).run(label, color, sortOrder, timestamp, id);

  const row = db.prepare('SELECT * FROM lanes WHERE id = ?').get(id) as LaneRow;
  return mapLane(row);
}

/**
 * 删除产业链泳道，并将当前图谱中的节点改为未分配泳道。
 * @param id 泳道 ID。
 * @returns 是否删除了记录。
 */
export function deleteLane(id: string): boolean {
  const db = getDatabase();
  const deleteWithUnassign = db.transaction(() => {
    db.prepare('UPDATE graph_nodes SET lane_id = NULL WHERE lane_id = ?').run(id);
    return db.prepare('DELETE FROM lanes WHERE id = ?').run(id);
  });
  const result = deleteWithUnassign();
  return result.changes > 0;
}

/**
 * 新增图谱节点，并加入指定产业图谱。
 * @param input 节点输入信息。
 * @returns 创建后的节点。
 */
export function createNode(input: NodeInput): ResearchNode {
  const db = getDatabase();
  const graphId = cleanText(input.graphId);
  if (!graphId) {
    throw new Error('新增节点必须指定产业图谱');
  }
  assertGraphExists(db, graphId);

  const nodeType = parseEnum(input.type, NODE_TYPES, '节点类型') as ResearchNodeType;
  const weightTier = input.weightTier
    ? (parseEnum(input.weightTier, NODE_WEIGHT_TIERS, '节点权重') as NodeWeightTier)
    : 'medium';
  const label = cleanText(input.label);
  if (!label) {
    throw new Error('节点名称不能为空');
  }

  const laneId = cleanText(input.laneId);
  if (laneId) {
    const lane = db.prepare('SELECT id FROM lanes WHERE id = ? AND graph_id = ?').get(laneId, graphId);
    if (!lane) {
      throw new Error(`泳道不存在或不属于当前图谱: ${laneId}`);
    }
  }

  const listingFields = prepareNodeListingFields(nodeType, input.market, input.ticker);
  const timestamp = nowIso();
  const id = randomUUID();
  const createWithMembership = db.transaction(() => {
    db.prepare(`
      INSERT INTO nodes (id, type, label, weight_tier, summary, ticker, market, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      nodeType,
      label,
      weightTier,
      cleanText(input.summary),
      listingFields.ticker,
      listingFields.market,
      timestamp,
      timestamp
    );
    ensureGraphNode(db, graphId, id, laneId);
  });
  createWithMembership();

  const row = db.prepare(`
    SELECT n.*, gn.lane_id, gn.sort_order
    FROM nodes n
    JOIN graph_nodes gn ON gn.node_id = n.id AND gn.graph_id = ?
    WHERE n.id = ?
  `).get(graphId, id) as NodeRow;
  return mapNode(row);
}

/**
 * 更新图谱节点。
 * @param id 节点 ID。
 * @param input 节点更新字段。
 * @returns 更新后的节点。
 */
export function updateNode(id: string, input: Partial<NodeInput>): ResearchNode {
  const db = getDatabase();
  const graphId = cleanText(input.graphId);
  const existing = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as Omit<NodeRow, 'lane_id'> | undefined;
  if (!existing) {
    throw new Error(`节点不存在: ${id}`);
  }

  const nextType = input.type
    ? (parseEnum(input.type, NODE_TYPES, '节点类型') as ResearchNodeType)
    : existing.type;
  const nextWeightTier = input.weightTier
    ? (parseEnum(input.weightTier, NODE_WEIGHT_TIERS, '节点权重') as NodeWeightTier)
    : existing.weight_tier;
  const nextLabel = input.label === undefined ? existing.label : cleanText(input.label);
  if (!nextLabel) {
    throw new Error('节点名称不能为空');
  }

  const listingInputChanged = input.type !== undefined || input.market !== undefined || input.ticker !== undefined;
  const listingFields = listingInputChanged
    ? prepareNodeListingFields(
        nextType,
        input.market === undefined ? existing.market || '' : input.market,
        input.ticker === undefined ? existing.ticker || '' : input.ticker
      )
    : {
        market: existing.market || '',
        ticker: existing.ticker || '',
      };
  const timestamp = nowIso();
  const updateNodeTransaction = db.transaction(() => {
    db.prepare(`
      UPDATE nodes
      SET type = ?, label = ?, weight_tier = ?, summary = ?, ticker = ?, market = ?, updated_at = ?
      WHERE id = ?
    `).run(
      nextType,
      nextLabel,
      nextWeightTier,
      input.summary === undefined ? existing.summary || '' : cleanText(input.summary),
      listingFields.ticker,
      listingFields.market,
      timestamp,
      id
    );

    if (graphId && input.laneId !== undefined) {
      assertGraphExists(db, graphId);
      const laneId = cleanText(input.laneId);
      if (laneId) {
        const lane = db.prepare('SELECT id FROM lanes WHERE id = ? AND graph_id = ?').get(laneId, graphId);
        if (!lane) {
          throw new Error(`泳道不存在或不属于当前图谱: ${laneId}`);
        }
      }
      ensureGraphNode(db, graphId, id, laneId);
    }
  });
  updateNodeTransaction();

  const row = graphId
    ? db.prepare(`
        SELECT n.*, gn.lane_id, gn.sort_order
        FROM nodes n
        LEFT JOIN graph_nodes gn ON gn.node_id = n.id AND gn.graph_id = ?
        WHERE n.id = ?
      `).get(graphId, id) as NodeRow
    : {
        ...existing,
        type: nextType,
        label: nextLabel,
        weight_tier: nextWeightTier,
        summary: input.summary === undefined ? existing.summary || '' : cleanText(input.summary),
        ticker: listingFields.ticker,
        market: listingFields.market,
        updated_at: timestamp,
        lane_id: null,
        sort_order: 0,
      } as NodeRow;
  return mapNode(row);
}

/**
 * 删除图谱节点。
 * @param id 节点 ID。
 * @returns 是否删除了记录。
 */
export function deleteNode(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * 新增图谱关系。
 * @param input 关系输入信息。
 * @returns 创建后的关系。
 */
export function createEdge(input: EdgeInput): ResearchEdge {
  const db = getDatabase();
  const graphId = cleanText(input.graphId);
  if (!graphId) {
    throw new Error('新增关系必须指定产业图谱');
  }
  assertGraphExists(db, graphId);

  const sourceId = cleanText(input.sourceId);
  const targetId = cleanText(input.targetId);
  if (!sourceId || !targetId) {
    throw new Error('关系两端节点不能为空');
  }
  if (sourceId === targetId) {
    throw new Error('关系不能连接到同一个节点');
  }

  const source = db.prepare('SELECT id FROM nodes WHERE id = ?').get(sourceId);
  const target = db.prepare('SELECT id FROM nodes WHERE id = ?').get(targetId);
  if (!source || !target) {
    throw new Error('关系两端节点必须存在');
  }

  const relationType = parseEnum(input.relationType, RELATION_TYPES, '关系类型') as RelationType;
  const status = input.status
    ? (parseEnum(input.status, EDGE_STATUSES, '关系状态') as EdgeStatus)
    : 'unverified';
  const weight = 1;
  const timestamp = nowIso();
  const id = randomUUID();

  const createEdgeTransaction = db.transaction(() => {
    ensureGraphNode(db, graphId, sourceId);
    ensureGraphNode(db, graphId, targetId);
    db.prepare(`
      INSERT INTO edges (id, graph_id, source_id, target_id, relation_type, status, weight, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, graphId, sourceId, targetId, relationType, status, weight, cleanText(input.note), timestamp, timestamp);
  });
  createEdgeTransaction();

  const row = db.prepare('SELECT * FROM edges WHERE id = ?').get(id) as EdgeRow;
  return mapEdge(row);
}

/**
 * 更新图谱关系。
 * @param id 关系 ID。
 * @param input 关系更新字段。
 * @returns 更新后的关系。
 */
export function updateEdge(id: string, input: Partial<EdgeInput>): ResearchEdge {
  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM edges WHERE id = ?').get(id) as EdgeRow | undefined;
  if (!existing) {
    throw new Error(`关系不存在: ${id}`);
  }

  const graphId = input.graphId ? cleanText(input.graphId) : existing.graph_id;
  assertGraphExists(db, graphId);
  const sourceId = input.sourceId === undefined ? existing.source_id : cleanText(input.sourceId);
  const targetId = input.targetId === undefined ? existing.target_id : cleanText(input.targetId);
  if (!sourceId || !targetId) {
    throw new Error('关系两端节点不能为空');
  }
  if (sourceId === targetId) {
    throw new Error('关系不能连接到同一个节点');
  }

  const relationType = input.relationType
    ? (parseEnum(input.relationType, RELATION_TYPES, '关系类型') as RelationType)
    : existing.relation_type;
  const status = input.status
    ? (parseEnum(input.status, EDGE_STATUSES, '关系状态') as EdgeStatus)
    : existing.status;
  const timestamp = nowIso();

  const updateEdgeTransaction = db.transaction(() => {
    ensureGraphNode(db, graphId, sourceId);
    ensureGraphNode(db, graphId, targetId);
    db.prepare(`
      UPDATE edges
      SET graph_id = ?, source_id = ?, target_id = ?, relation_type = ?, status = ?, weight = ?, note = ?, updated_at = ?
      WHERE id = ?
    `).run(
      graphId,
      sourceId,
      targetId,
      relationType,
      status,
      existing.weight,
      input.note === undefined ? existing.note || '' : cleanText(input.note),
      timestamp,
      id
    );
  });
  updateEdgeTransaction();

  const row = db.prepare('SELECT * FROM edges WHERE id = ?').get(id) as EdgeRow;
  return mapEdge(row);
}

/**
 * 删除图谱关系。
 * @param id 关系 ID。
 * @returns 是否删除了记录。
 */
export function deleteEdge(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM edges WHERE id = ?').run(id);
  return result.changes > 0;
}
