export const NODE_TYPES = [
  'narrative',
  'industry',
  'concept',
  'product',
  'material',
  'process',
  'company',
] as const;

export const RELATION_TYPES = [
  'contains',
  'upstream',
  'downstream',
  'produces',
  'supplies',
  'benefits',
  'substitute',
  'competition',
  'exposure',
] as const;

export const EDGE_STATUSES = ['fact', 'research', 'unverified'] as const;
export const NODE_WEIGHT_TIERS = ['high', 'medium', 'low'] as const;

export type ResearchNodeType = (typeof NODE_TYPES)[number];
export type RelationType = (typeof RELATION_TYPES)[number];
export type EdgeStatus = (typeof EDGE_STATUSES)[number];
export type NodeWeightTier = (typeof NODE_WEIGHT_TIERS)[number];

export interface IndustryGraph {
  id: string;
  label: string;
  summary: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchLane {
  id: string;
  graphId: string;
  label: string;
  color: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchNode {
  id: string;
  type: ResearchNodeType;
  laneId: string;
  sortOrder: number;
  label: string;
  weightTier: NodeWeightTier;
  summary: string;
  ticker: string;
  market: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchEdge {
  id: string;
  graphId: string;
  sourceId: string;
  targetId: string;
  relationType: RelationType;
  status: EdgeStatus;
  weight: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface GraphNodeMembership {
  graphId: string;
  nodeId: string;
  laneId: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface GraphExportNode {
  id: string;
  type: ResearchNodeType;
  label: string;
  weightTier: NodeWeightTier;
  summary: string;
  ticker: string;
  market: string;
  createdAt: string;
  updatedAt: string;
}

export interface GraphExportDocument {
  schemaVersion: 1;
  kind: 'stock-research-graph.graph';
  exportedAt: string;
  graph: IndustryGraph;
  lanes: ResearchLane[];
  nodes: GraphExportNode[];
  memberships: GraphNodeMembership[];
  edges: ResearchEdge[];
}

export interface GraphImportValidationIssue {
  path: string;
  message: string;
}

export interface GraphImportResult {
  graphId: string;
  graphLabel: string;
  created: boolean;
  lanes: number;
  nodes: number;
  memberships: number;
  edges: number;
}

export interface GraphAuthoringDocument {
  schemaVersion: 2;
  kind: 'stock-research-graph.authoring';
  graph: GraphAuthoringGraph;
  lanes: GraphAuthoringLane[];
  nodes: GraphAuthoringNode[];
  edges: GraphAuthoringEdge[];
}

export interface GraphAuthoringGraph {
  label: string;
  summary?: string;
  sortOrder?: number;
}

export interface GraphAuthoringLane {
  label: string;
  color?: string;
  order?: number;
}

export interface GraphAuthoringNode {
  type: ResearchNodeType;
  label: string;
  weightTier?: NodeWeightTier;
  lane?: string;
  order?: number;
  summary?: string;
  ticker?: string;
  market?: string;
}

export interface GraphAuthoringEdge {
  from: string;
  to: string;
  relationType: RelationType;
  status?: EdgeStatus;
  weight?: number;
  note?: string;
}

export interface GraphSnapshot {
  graphs: IndustryGraph[];
  currentGraphId: string;
  lanes: ResearchLane[];
  nodes: ResearchNode[];
  edges: ResearchEdge[];
}

export interface NodeInput {
  graphId?: string;
  type: ResearchNodeType;
  label: string;
  weightTier?: NodeWeightTier;
  laneId?: string;
  summary?: string;
  ticker?: string;
  market?: string;
}

export interface EdgeInput {
  graphId?: string;
  sourceId: string;
  targetId: string;
  relationType: RelationType;
  status?: EdgeStatus;
  note?: string;
}

export interface LaneInput {
  graphId?: string;
  label: string;
  color?: string;
  sortOrder?: number;
}

export interface GraphInput {
  label: string;
  summary?: string;
}
