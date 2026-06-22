'use client';

import {
  Background,
  BaseEdge,
  Controls,
  Edge,
  EdgeLabelRenderer,
  EdgeProps,
  Handle,
  MarkerType,
  Node,
  NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import {
  EDGE_STATUS_LABELS,
  getNodeWeightTierLabel,
  NODE_TYPE_LABELS,
  RELATION_TYPE_LABELS,
} from '../lib/graph-labels';
import {
  EdgeStatus,
  GraphSnapshot,
  NodeWeightTier,
  RelationType,
  ResearchEdge,
  ResearchLane,
  ResearchNode,
  ResearchNodeType,
} from '../lib/graph-types';

export type GraphViewMode = 'industry' | 'company';

interface GraphCanvasProps {
  snapshot: GraphSnapshot;
  viewMode: GraphViewMode;
  selectedNodeId: string;
  selectedEdgeId: string;
  searchText: string;
  relationFilter: RelationType | 'all';
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
}

type CanvasNodeData = {
  kind: 'circle' | 'lane';
  label: string;
  subtitle: string;
  nodeType: ResearchNodeType | 'lane';
  color: string;
  size: number;
  isSelected: boolean;
  isRelated: boolean;
  isDimmed: boolean;
};

type CanvasEdgeData = {
  label: string;
  color: string;
  dashArray?: string;
  strokeWidth: number;
  sourceRadius: number;
  targetRadius: number;
  showLabel: boolean;
  isSelected: boolean;
  isRelated: boolean;
  isDimmed: boolean;
};

type FlowElements = {
  nodes: Node<CanvasNodeData>[];
  edges: Edge<CanvasEdgeData>[];
};

type VisibleGraphModel = {
  nodeById: Map<string, ResearchNode>;
  visibleNodes: ResearchNode[];
  visibleEdges: ResearchEdge[];
};

type GraphInteractionState = {
  relatedNodeIds: Set<string>;
  hasNodeSelection: boolean;
};

type LayoutLane = Pick<ResearchLane, 'id' | 'label' | 'color' | 'sortOrder'> & {
  isVirtual: boolean;
};

type NodeDimensions = {
  width: number;
  height: number;
};

type LanePlacement = {
  node: ResearchNode;
  dimensions: NodeDimensions;
  x: number;
  y: number;
};

type PackedLaneLayout = {
  lane: LayoutLane;
  placements: LanePlacement[];
  height: number;
  maxRight: number;
};

const elkLayoutEngine = new ELK();
const TOPIC_LANE_ID = '__topic-lane';
const ORPHAN_COMPANY_LANE_ID = '__orphan-company-lane';
const LANE_LEFT = 24;
const LANE_TOP = 24;
const LANE_VERTICAL_GAP = 14;
const LANE_MIN_HEIGHT = 132;
const LANE_MIN_WIDTH = 960;
const LANE_CONTENT_LEFT = 148;
const LANE_RIGHT_PADDING = 88;
const LANE_HEADER_HEIGHT = 48;
const LANE_ROW_HEIGHT = 108;
const LANE_BOTTOM_PADDING = 30;
const NODE_GAP_X = 46;
const MAX_HORIZONTAL_SHIFT = 520;
const COMPANY_ATTACHMENT_OFFSET_X = 32;
const ELK_LAYER_SPACING = 150;
const ELK_NODE_SPACING = 82;
const NODE_SIZE_BY_WEIGHT: Record<NodeWeightTier, number> = {
  high: 38,
  medium: 30,
  low: 23,
};
const EMPTY_RELATED_NODE_IDS = new Set<string>();

/**
 * 判断是否为公司节点。
 * @param node 图谱节点。
 * @returns 是否为公司。
 */
function isCompanyNode(node: ResearchNode): boolean {
  return node.type === 'company';
}

/**
 * 根据节点类型返回圆点颜色。
 * @param nodeType 图谱节点类型。
 * @returns 十六进制颜色值。
 */
function getNodeColor(nodeType: ResearchNodeType): string {
  const colorByType: Record<ResearchNodeType, string> = {
    narrative: '#f59e0b',
    industry: '#16a34a',
    concept: '#2563eb',
    product: '#7c3aed',
    material: '#ea580c',
    process: '#0891b2',
    company: '#0f766e',
  };
  return colorByType[nodeType];
}

/**
 * 根据关系状态返回线条颜色。
 * @param status 关系状态。
 * @returns CSS 颜色值。
 */
function getStatusColor(status: EdgeStatus): string {
  const colorByStatus: Record<EdgeStatus, string> = {
    fact: '#0f766e',
    research: '#4f46e5',
    unverified: '#d97706',
  };
  return colorByStatus[status];
}

/**
 * 根据关系状态返回线条样式。
 * @param status 关系状态。
 * @returns SVG stroke-dasharray 值。
 */
function getStatusDash(status: EdgeStatus): string | undefined {
  if (status === 'research') {
    return '8 6';
  }
  if (status === 'unverified') {
    return '2 6';
  }
  return undefined;
}

/**
 * 将数值限制在指定区间内。
 * @param value 原始数值。
 * @param min 最小值。
 * @param max 最大值。
 * @returns 限制后的数值。
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 根据文本生成稳定的方向种子。
 * @param value 原始文本。
 * @returns 方向种子，值为 -1 或 1。
 */
function getCurveDirection(value: string): number {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) % 997;
  }
  return hash % 2 === 0 ? 1 : -1;
}

/**
 * 生成分层放射式关系路径。
 * @param edgeId 关系 ID。
 * @param sourceX 源节点圆心 X。
 * @param sourceY 源节点圆心 Y。
 * @param targetX 目标节点圆心 X。
 * @param targetY 目标节点圆心 Y。
 * @param sourceRadius 源节点圆点半径。
 * @param targetRadius 目标节点圆点半径。
 * @returns SVG 路径和标签坐标。
 */
function getLayeredRadiantEdgePath(
  edgeId: string,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourceRadius: number,
  targetRadius: number
): { path: string; labelX: number; labelY: number } {
  const centerDeltaX = targetX - sourceX;
  const centerDeltaY = targetY - sourceY;
  const centerDistance = Math.hypot(centerDeltaX, centerDeltaY) || 1;
  const unitX = centerDeltaX / centerDistance;
  const unitY = centerDeltaY / centerDistance;
  const startX = sourceX + unitX * (sourceRadius + 1);
  const startY = sourceY + unitY * (sourceRadius + 1);
  const endX = targetX - unitX * (targetRadius + 1);
  const endY = targetY - unitY * (targetRadius + 1);
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const distance = Math.hypot(deltaX, deltaY) || 1;
  const sameLane = Math.abs(deltaY) < 44;
  const curveDirection = getCurveDirection(edgeId);
  const normalX = -deltaY / distance;
  const normalY = deltaX / distance;
  let controlX1 = startX + deltaX * 0.34;
  let controlY1 = startY + deltaY * 0.34;
  let controlX2 = startX + deltaX * 0.68;
  let controlY2 = startY + deltaY * 0.68;

  if (sameLane) {
    const sameLaneBow = clamp(Math.abs(deltaX) * 0.045, 7, 22) * curveDirection;
    controlY1 += sameLaneBow;
    controlY2 += sameLaneBow;
  } else {
    const laneBow = clamp(distance * 0.035, 10, 42) * curveDirection;
    controlX1 += normalX * laneBow;
    controlY1 += normalY * laneBow;
    controlX2 += normalX * laneBow;
    controlY2 += normalY * laneBow;
  }

  const labelX = (startX + endX + controlX1 + controlX2) / 4;
  const labelY = (startY + endY + controlY1 + controlY2) / 4;

  return {
    path: `M ${startX},${startY} C ${controlX1},${controlY1} ${controlX2},${controlY2} ${endX},${endY}`,
    labelX,
    labelY,
  };
}

/**
 * 根据节点权重档位返回圆点尺寸。
 * @param weightTier 节点权重档位。
 * @returns 圆点直径，单位为像素。
 */
function getNodeSize(weightTier: NodeWeightTier): number {
  return NODE_SIZE_BY_WEIGHT[weightTier];
}

/**
 * 根据节点权重档位返回 React Flow 圆点节点外框尺寸。
 * @param weightTier 节点权重档位。
 * @returns 圆点节点宽高，单位为像素。
 */
function getCircleNodeDimensions(weightTier: NodeWeightTier): { width: number; height: number } {
  const nodeSize = getNodeSize(weightTier);
  return {
    width: nodeSize + 104,
    height: nodeSize + 56,
  };
}

/**
 * 按业务顺序稳定排序节点。
 * @param leftNode 左侧待比较节点。
 * @param rightNode 右侧待比较节点。
 * @returns 排序比较结果。
 */
function compareResearchNodes(leftNode: ResearchNode, rightNode: ResearchNode): number {
  return leftNode.sortOrder - rightNode.sortOrder
    || leftNode.label.localeCompare(rightNode.label, 'zh-CN')
    || leftNode.id.localeCompare(rightNode.id);
}

/**
 * 按横向布局位置和业务顺序稳定排序节点。
 * @param leftNode 左侧待比较节点。
 * @param rightNode 右侧待比较节点。
 * @param desiredXByNodeId 节点期望横坐标索引。
 * @returns 排序比较结果。
 */
function compareNodesByDesiredX(
  leftNode: ResearchNode,
  rightNode: ResearchNode,
  desiredXByNodeId: Map<string, number>
): number {
  return (desiredXByNodeId.get(leftNode.id) || LANE_CONTENT_LEFT)
    - (desiredXByNodeId.get(rightNode.id) || LANE_CONTENT_LEFT)
    || compareResearchNodes(leftNode, rightNode);
}

/**
 * 获取节点副标题。
 * @param node 图谱节点。
 * @returns 类型、市场代码和权重档位组成的说明。
 */
function getNodeSubtitle(node: ResearchNode): string {
  const weightLabel = getNodeWeightTierLabel(node.type, node.weightTier);
  if (isCompanyNode(node)) {
    return [node.market, node.ticker, weightLabel].filter(Boolean).join(' · ');
  }
  return `${NODE_TYPE_LABELS[node.type]} · ${weightLabel}`;
}

/**
 * 创建 React Flow 圆点节点。
 * @param node 业务图谱节点。
 * @param position 节点左上角坐标。
 * @param relatedNodeIds 当前选中节点的一跳关联集合。
 * @param selectedNodeId 当前选中节点 ID。
 * @param hasSelection 是否存在有效选中节点。
 * @returns React Flow 节点。
 */
function createCircleFlowNode(
  node: ResearchNode,
  position: { x: number; y: number },
  relatedNodeIds: Set<string>,
  selectedNodeId: string,
  hasSelection: boolean
): Node<CanvasNodeData> {
  const nodeDimensions = getCircleNodeDimensions(node.weightTier);
  const isSelected = node.id === selectedNodeId;
  const isRelated = relatedNodeIds.has(node.id);
  return {
    id: node.id,
    type: 'circle',
    width: nodeDimensions.width,
    height: nodeDimensions.height,
    measured: nodeDimensions,
    position,
    data: {
      kind: 'circle',
      label: node.label,
      subtitle: getNodeSubtitle(node),
      nodeType: node.type,
      color: getNodeColor(node.type),
      size: getNodeSize(node.weightTier),
      isSelected,
      isRelated,
      isDimmed: hasSelection && !isRelated,
    },
  };
}

/**
 * 创建不带交互高亮状态的基础圆点节点。
 * @param node 业务图谱节点。
 * @param position 节点左上角坐标。
 * @returns React Flow 基础圆点节点。
 */
function createBaseCircleFlowNode(
  node: ResearchNode,
  position: { x: number; y: number }
): Node<CanvasNodeData> {
  return createCircleFlowNode(node, position, EMPTY_RELATED_NODE_IDS, '', false);
}

/**
 * 判断节点是否命中搜索文本。
 * @param node 图谱节点。
 * @param searchText 搜索文本。
 * @returns 是否匹配。
 */
function matchesSearch(node: ResearchNode, searchText: string): boolean {
  const normalizedSearch = searchText.trim().toLowerCase();
  if (!normalizedSearch) {
    return true;
  }
  return [
    node.label,
    node.summary,
    node.ticker,
    node.market,
    NODE_TYPE_LABELS[node.type],
    getNodeWeightTierLabel(node.type, node.weightTier),
  ].some((value) => value.toLowerCase().includes(normalizedSearch));
}

/**
 * 获取选中节点的一跳关联节点。
 * @param selectedNodeId 当前选中节点 ID。
 * @param edges 当前可见关系列表。
 * @returns 关联节点 ID 集合。
 */
function collectRelatedNodeIds(selectedNodeId: string, edges: ResearchEdge[]): Set<string> {
  const relatedNodeIds = new Set<string>();
  if (!selectedNodeId) {
    return relatedNodeIds;
  }

  relatedNodeIds.add(selectedNodeId);
  for (const edge of edges) {
    if (edge.sourceId === selectedNodeId) {
      relatedNodeIds.add(edge.targetId);
    }
    if (edge.targetId === selectedNodeId) {
      relatedNodeIds.add(edge.sourceId);
    }
  }
  return relatedNodeIds;
}

/**
 * 判断关系是否应该出现在当前视图。
 * @param edge 图谱关系。
 * @param nodeById 节点索引。
 * @param viewMode 当前视图模式。
 * @returns 关系是否属于当前图谱视图。
 */
function edgeBelongsToView(
  edge: ResearchEdge,
  nodeById: Map<string, ResearchNode>,
  viewMode: GraphViewMode
): boolean {
  const sourceNode = nodeById.get(edge.sourceId);
  const targetNode = nodeById.get(edge.targetId);
  if (!sourceNode || !targetNode) {
    return false;
  }
  if (viewMode === 'company') {
    return isCompanyNode(sourceNode) && isCompanyNode(targetNode);
  }
  return !(isCompanyNode(sourceNode) && isCompanyNode(targetNode));
}

/**
 * 判断节点是否应该出现在当前视图。
 * @param node 图谱节点。
 * @param viewMode 当前视图模式。
 * @returns 节点是否属于当前图谱视图。
 */
function nodeBelongsToView(node: ResearchNode, viewMode: GraphViewMode): boolean {
  if (viewMode === 'company') {
    return isCompanyNode(node);
  }
  return true;
}

/**
 * 产业链泳道节点。
 * @param props React Flow 节点属性。
 * @returns 泳道背景节点。
 */
function LaneBandNode({ data }: NodeProps<Node<CanvasNodeData>>) {
  return (
    <div className="laneBandNode" style={{ borderLeftColor: data.color }}>
      <span>{data.label}</span>
    </div>
  );
}

/**
 * 圆点图谱节点。
 * @param props React Flow 节点属性。
 * @returns 圆点和节点标签。
 */
function CircleNode({ data }: NodeProps<Node<CanvasNodeData>>) {
  return (
    <div
      className={[
        'circleNode',
        data.isSelected ? 'selected' : '',
        data.isRelated ? 'related' : '',
        data.isDimmed ? 'dimmed' : '',
      ].filter(Boolean).join(' ')}
      style={{
        width: data.size + 104,
        '--node-dot-size': `${data.size}px`,
        '--node-color': data.color,
      } as CSSProperties}
    >
      <Handle id="target-left" className="dotHandle leftHandle" type="target" position={Position.Left} />
      <Handle id="source-left" className="dotHandle leftHandle" type="source" position={Position.Left} />
      <Handle id="target-right" className="dotHandle rightHandle" type="target" position={Position.Right} />
      <Handle id="source-right" className="dotHandle rightHandle" type="source" position={Position.Right} />
      <div
        className="circleNodeDot"
        style={{
          width: data.size,
          height: data.size,
          boxShadow: data.isSelected ? `0 0 0 8px ${data.color}22` : undefined,
        }}
      />
      <div className="circleNodeLabel">
        <strong>{data.label}</strong>
        {data.subtitle && <span>{data.subtitle}</span>}
      </div>
    </div>
  );
}

/**
 * 液态曲线关系边。
 * @param props React Flow 边属性。
 * @returns 自定义曲线边和浮动标签。
 */
function LiquidEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  data,
}: EdgeProps<Edge<CanvasEdgeData>>) {
  const edgeData = data || {
    label: '',
    color: '#94a3b8',
    strokeWidth: 1.8,
    sourceRadius: 14,
    targetRadius: 14,
    showLabel: false,
    isSelected: false,
    isRelated: false,
    isDimmed: false,
  };
  const { path, labelX, labelY } = getLayeredRadiantEdgePath(
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    edgeData.sourceRadius,
    edgeData.targetRadius
  );
  const gradientId = `edge-gradient-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const isActive = edgeData.isSelected || edgeData.isRelated;
  const edgeStroke = edgeData.isSelected ? `url(#${gradientId})` : edgeData.color;

  return (
    <>
      {edgeData.isSelected && (
        <defs>
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1={sourceX}
            y1={sourceY}
            x2={targetX}
            y2={targetY}
          >
            <stop offset="0%" stopColor={edgeData.color} />
            <stop offset="48%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#a78bfa" />
          </linearGradient>
        </defs>
      )}
      {edgeData.isSelected && (
        <BaseEdge
          className="liquidEdgeGlow selected"
          path={path}
          interactionWidth={0}
          style={{
            stroke: edgeStroke,
            strokeWidth: edgeData.strokeWidth + 5,
          }}
        />
      )}
      <BaseEdge
        className={[
          'liquidEdgePath',
          edgeData.isSelected ? 'selected' : '',
          isActive ? 'active' : '',
          edgeData.isDimmed ? 'dimmed' : '',
        ].filter(Boolean).join(' ')}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={26}
        style={{
          stroke: edgeStroke,
          strokeWidth: edgeData.strokeWidth,
          strokeDasharray: edgeData.dashArray,
        }}
      />
      {edgeData.showLabel && (
        <EdgeLabelRenderer>
          <div
            className={[
              'liquidEdgeLabel',
              edgeData.isSelected ? 'selected' : '',
              edgeData.isDimmed ? 'dimmed' : '',
            ].filter(Boolean).join(' ')}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {edgeData.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = {
  circle: CircleNode,
  lane: LaneBandNode,
};

const edgeTypes = {
  liquid: LiquidEdge,
};

/**
 * 为 ELK 失败或无边图谱生成兜底横向层级坐标。
 * @param visibleNodes 当前可见节点。
 * @returns 节点 ID 到横坐标的映射。
 */
function createFallbackLayeredXByNodeId(visibleNodes: ResearchNode[]): Map<string, number> {
  const layerByType: Record<ResearchNodeType, number> = {
    narrative: 0,
    industry: 1,
    concept: 1,
    product: 2,
    material: 2,
    process: 2,
    company: 3,
  };
  const layerOffsets = new Map<number, number>();
  const fallbackXByNodeId = new Map<string, number>();
  [...visibleNodes].sort(compareResearchNodes).forEach((node) => {
    const layer = layerByType[node.type];
    const offset = layerOffsets.get(layer) || 0;
    fallbackXByNodeId.set(node.id, LANE_CONTENT_LEFT + layer * 230 + offset * 18);
    layerOffsets.set(layer, offset + 1);
  });
  return fallbackXByNodeId;
}

/**
 * 使用 ELK layered 算法生成横向层级坐标。
 * @param visibleNodes 当前可见节点。
 * @param visibleEdges 当前可见关系。
 * @returns 节点 ID 到横坐标的映射。
 */
async function createElkLayeredXByNodeId(
  visibleNodes: ResearchNode[],
  visibleEdges: ResearchEdge[]
): Promise<Map<string, number>> {
  if (visibleNodes.length === 0) {
    return new Map();
  }

  const layoutGraph: ElkNode = {
    id: 'industry-layout',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'SPLINES',
      'elk.separateConnectedComponents': 'false',
      'elk.spacing.nodeNode': String(ELK_NODE_SPACING),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(ELK_LAYER_SPACING),
      'elk.layered.spacing.edgeNodeBetweenLayers': '56',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '22',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.cycleBreaking.strategy': 'GREEDY',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.considerModelOrder.components': 'FORCE',
    },
    children: [...visibleNodes].sort(compareResearchNodes).map((node) => {
      const nodeDimensions = getCircleNodeDimensions(node.weightTier);
      return {
        id: node.id,
        width: nodeDimensions.width,
        height: nodeDimensions.height,
        layoutOptions: {
          'elk.layered.crossingMinimization.positionId': String(node.sortOrder),
        },
      };
    }),
    edges: visibleEdges.map((edge) => ({
      id: edge.id,
      sources: [edge.sourceId],
      targets: [edge.targetId],
    })),
  };

  try {
    const layoutResult = await elkLayoutEngine.layout(layoutGraph);
    const layoutChildren = layoutResult.children || [];
    if (layoutChildren.length === 0) {
      return createFallbackLayeredXByNodeId(visibleNodes);
    }

    const minX = Math.min(...layoutChildren.map((childNode) => childNode.x || 0));
    const elkXByNodeId = new Map<string, number>();
    for (const childNode of layoutChildren) {
      elkXByNodeId.set(childNode.id, LANE_CONTENT_LEFT + (childNode.x || 0) - minX);
    }
    return elkXByNodeId;
  } catch (error) {
    console.warn('产业链 ELK 布局失败，已使用业务顺序兜底布局。', error);
    return createFallbackLayeredXByNodeId(visibleNodes);
  }
}

/**
 * 根据公司连接的产业节点推断公司应贴近的泳道。
 * @param visibleEdges 当前可见关系。
 * @param nodeById 节点索引。
 * @param laneIndexById 泳道顺序索引。
 * @returns 公司节点 ID 到泳道 ID 的映射。
 */
function inferCompanyLaneByNodeId(
  visibleEdges: ResearchEdge[],
  nodeById: Map<string, ResearchNode>,
  laneIndexById: Map<string, number>
): Map<string, string> {
  const laneScoresByCompanyId = new Map<string, Map<string, number>>();

  for (const edge of visibleEdges) {
    const sourceNode = nodeById.get(edge.sourceId);
    const targetNode = nodeById.get(edge.targetId);
    if (!sourceNode || !targetNode) {
      continue;
    }

    const pairs = [
      { companyNode: sourceNode, relatedNode: targetNode },
      { companyNode: targetNode, relatedNode: sourceNode },
    ];
    for (const pair of pairs) {
      if (!isCompanyNode(pair.companyNode) || !pair.relatedNode.laneId || !laneIndexById.has(pair.relatedNode.laneId)) {
        continue;
      }

      const laneScores = laneScoresByCompanyId.get(pair.companyNode.id) || new Map<string, number>();
      const statusWeight = edge.status === 'fact' ? 5 : edge.status === 'research' ? 3 : 1;
      laneScores.set(pair.relatedNode.laneId, (laneScores.get(pair.relatedNode.laneId) || 0) + edge.weight * 10 + statusWeight);
      laneScoresByCompanyId.set(pair.companyNode.id, laneScores);
    }
  }

  const companyLaneByNodeId = new Map<string, string>();
  for (const [companyNodeId, laneScores] of laneScoresByCompanyId) {
    const bestLane = [...laneScores.entries()].sort((leftEntry, rightEntry) => (
      rightEntry[1] - leftEntry[1]
      || (laneIndexById.get(leftEntry[0]) || 0) - (laneIndexById.get(rightEntry[0]) || 0)
    ))[0];
    if (bestLane) {
      companyLaneByNodeId.set(companyNodeId, bestLane[0]);
    }
  }
  return companyLaneByNodeId;
}

/**
 * 解析节点在产业链视图中的展示泳道。
 * @param node 当前节点。
 * @param companyLaneByNodeId 公司贴近泳道索引。
 * @param laneIndexById 真实泳道索引。
 * @returns 展示泳道 ID。
 */
function resolveDisplayLaneId(
  node: ResearchNode,
  companyLaneByNodeId: Map<string, string>,
  laneIndexById: Map<string, number>
): string {
  if (node.laneId && laneIndexById.has(node.laneId)) {
    return node.laneId;
  }
  if (isCompanyNode(node)) {
    return companyLaneByNodeId.get(node.id) || ORPHAN_COMPANY_LANE_ID;
  }
  return TOPIC_LANE_ID;
}

/**
 * 根据真实泳道和虚拟泳道构造展示泳道列表。
 * @param sortedLanes 已排序的真实泳道列表。
 * @param nodesByLane 展示泳道到节点列表的映射。
 * @returns 展示泳道列表。
 */
function createLayoutLanes(
  sortedLanes: ResearchLane[],
  nodesByLane: Map<string, ResearchNode[]>
): LayoutLane[] {
  const layoutLanes: LayoutLane[] = [];
  if ((nodesByLane.get(TOPIC_LANE_ID)?.length || 0) > 0) {
    layoutLanes.push({
      id: TOPIC_LANE_ID,
      label: '主题',
      color: '#0f766e',
      sortOrder: -10000,
      isVirtual: true,
    });
  }

  layoutLanes.push(...sortedLanes.map((lane) => ({
    id: lane.id,
    label: lane.label,
    color: lane.color,
    sortOrder: lane.sortOrder,
    isVirtual: false,
  })));

  if ((nodesByLane.get(ORPHAN_COMPANY_LANE_ID)?.length || 0) > 0) {
    layoutLanes.push({
      id: ORPHAN_COMPANY_LANE_ID,
      label: '相关公司',
      color: '#64748b',
      sortOrder: 10000,
      isVirtual: true,
    });
  }
  return layoutLanes;
}

/**
 * 为公司节点计算贴近关联环节后的期望横坐标。
 * @param node 当前节点。
 * @param visibleEdges 当前可见关系。
 * @param nodeById 节点索引。
 * @param displayLaneByNodeId 节点展示泳道索引。
 * @param elkXByNodeId ELK 横向层级坐标。
 * @returns 节点期望横坐标。
 */
function getDesiredNodeX(
  node: ResearchNode,
  visibleEdges: ResearchEdge[],
  nodeById: Map<string, ResearchNode>,
  displayLaneByNodeId: Map<string, string>,
  elkXByNodeId: Map<string, number>
): number {
  const elkX = elkXByNodeId.get(node.id) || LANE_CONTENT_LEFT;
  if (!isCompanyNode(node)) {
    return Math.max(LANE_CONTENT_LEFT, elkX);
  }

  const ownLaneId = displayLaneByNodeId.get(node.id);
  const connectedXValues: number[] = [];
  for (const edge of visibleEdges) {
    const relatedNodeId = edge.sourceId === node.id
      ? edge.targetId
      : edge.targetId === node.id
        ? edge.sourceId
        : '';
    if (!relatedNodeId) {
      continue;
    }

    const relatedNode = nodeById.get(relatedNodeId);
    if (!relatedNode || isCompanyNode(relatedNode) || displayLaneByNodeId.get(relatedNode.id) !== ownLaneId) {
      continue;
    }
    connectedXValues.push(elkXByNodeId.get(relatedNode.id) || LANE_CONTENT_LEFT);
  }

  if (connectedXValues.length === 0) {
    return Math.max(LANE_CONTENT_LEFT, elkX);
  }
  const averageRelatedX = connectedXValues.reduce((sum, value) => sum + value, 0) / connectedXValues.length;
  return Math.max(LANE_CONTENT_LEFT, averageRelatedX + COMPANY_ATTACHMENT_OFFSET_X);
}

/**
 * 将单条泳道内的节点装箱到不重叠的多行布局。
 * @param lane 当前展示泳道。
 * @param laneNodes 泳道内节点。
 * @param desiredXByNodeId 节点期望横坐标索引。
 * @returns 泳道内节点摆放结果。
 */
function packLaneNodes(
  lane: LayoutLane,
  laneNodes: ResearchNode[],
  desiredXByNodeId: Map<string, number>
): PackedLaneLayout {
  const rowRightEdges: number[] = [];
  const placements: LanePlacement[] = [];
  const sortedLaneNodes = [...laneNodes].sort((leftNode, rightNode) => (
    compareNodesByDesiredX(leftNode, rightNode, desiredXByNodeId)
  ));

  for (const node of sortedLaneNodes) {
    const dimensions = getCircleNodeDimensions(node.weightTier);
    const desiredX = Math.max(LANE_CONTENT_LEFT, desiredXByNodeId.get(node.id) || LANE_CONTENT_LEFT);
    let selectedRowIndex = rowRightEdges.length;
    let x = desiredX;
    let smallestShift = Number.POSITIVE_INFINITY;

    rowRightEdges.forEach((rightEdge, rowIndex) => {
      const candidateX = Math.max(desiredX, rightEdge + NODE_GAP_X);
      const horizontalShift = candidateX - desiredX;
      if (horizontalShift <= MAX_HORIZONTAL_SHIFT && horizontalShift < smallestShift) {
        selectedRowIndex = rowIndex;
        x = candidateX;
        smallestShift = horizontalShift;
      }
    });

    const y = LANE_HEADER_HEIGHT + selectedRowIndex * LANE_ROW_HEIGHT;
    rowRightEdges[selectedRowIndex] = x + dimensions.width;
    placements.push({
      node,
      dimensions,
      x,
      y,
    });
  }

  const rowCount = Math.max(1, rowRightEdges.length);
  const maxRight = Math.max(LANE_CONTENT_LEFT, ...rowRightEdges);
  const height = placements.length > 0
    ? Math.max(LANE_MIN_HEIGHT, LANE_HEADER_HEIGHT + rowCount * LANE_ROW_HEIGHT + LANE_BOTTOM_PADDING)
    : LANE_MIN_HEIGHT;
  return {
    lane,
    placements,
    height,
    maxRight,
  };
}

/**
 * 创建泳道背景节点。
 * @param lane 展示泳道。
 * @param laneY 泳道纵坐标。
 * @param laneWidth 泳道宽度。
 * @param laneHeight 泳道高度。
 * @returns React Flow 泳道节点。
 */
function createLaneFlowNode(
  lane: LayoutLane,
  laneY: number,
  laneWidth: number,
  laneHeight: number
): Node<CanvasNodeData> {
  return {
    id: `lane-${lane.id}`,
    type: 'lane',
    position: { x: LANE_LEFT, y: laneY },
    width: laneWidth,
    height: laneHeight,
    measured: {
      width: laneWidth,
      height: laneHeight,
    },
    selectable: false,
    draggable: false,
    data: {
      kind: 'lane',
      label: lane.label,
      subtitle: '',
      nodeType: 'lane',
      color: lane.color,
      size: 0,
      isSelected: false,
      isRelated: false,
      isDimmed: false,
    },
    style: {
      width: laneWidth,
      height: laneHeight,
      zIndex: -10,
      pointerEvents: 'none',
    },
  };
}

/**
 * 为产业链图谱生成泳道约束下的分层布局。
 * @param visibleNodes 当前可见节点。
 * @param visibleEdges 当前可见关系。
 * @param lanes 泳道列表。
 * @returns React Flow 节点列表。
 */
async function buildIndustryNodes(
  visibleNodes: ResearchNode[],
  visibleEdges: ResearchEdge[],
  lanes: ResearchLane[]
): Promise<Node<CanvasNodeData>[]> {
  const sortedLanes = [...lanes].sort((leftLane, rightLane) => (
    leftLane.sortOrder - rightLane.sortOrder || leftLane.label.localeCompare(rightLane.label, 'zh-CN')
  ));
  const laneIndexById = new Map(sortedLanes.map((lane, index) => [lane.id, index]));
  const nodeById = new Map(visibleNodes.map((node) => [node.id, node]));
  const companyLaneByNodeId = inferCompanyLaneByNodeId(visibleEdges, nodeById, laneIndexById);
  const displayLaneByNodeId = new Map<string, string>();
  const nodesByLane = new Map<string, ResearchNode[]>();

  for (const node of visibleNodes) {
    const displayLaneId = resolveDisplayLaneId(node, companyLaneByNodeId, laneIndexById);
    const laneNodes = nodesByLane.get(displayLaneId) || [];
    laneNodes.push(node);
    nodesByLane.set(displayLaneId, laneNodes);
    displayLaneByNodeId.set(node.id, displayLaneId);
  }

  const elkXByNodeId = await createElkLayeredXByNodeId(visibleNodes, visibleEdges);
  const desiredXByNodeId = new Map<string, number>();
  for (const node of visibleNodes) {
    desiredXByNodeId.set(
      node.id,
      getDesiredNodeX(node, visibleEdges, nodeById, displayLaneByNodeId, elkXByNodeId)
    );
  }

  const layoutLanes = createLayoutLanes(sortedLanes, nodesByLane);
  const packedLanes = layoutLanes.map((lane) => (
    packLaneNodes(lane, nodesByLane.get(lane.id) || [], desiredXByNodeId)
  ));
  const laneWidth = Math.max(
    LANE_MIN_WIDTH,
    ...packedLanes.map((packedLane) => packedLane.maxRight + LANE_RIGHT_PADDING)
  );

  const flowNodes: Node<CanvasNodeData>[] = [];
  let nextLaneY = LANE_TOP;
  for (const packedLane of packedLanes) {
    flowNodes.push(createLaneFlowNode(packedLane.lane, nextLaneY, laneWidth, packedLane.height));
    for (const placement of packedLane.placements) {
      flowNodes.push(createBaseCircleFlowNode(
        placement.node,
        {
          x: placement.x,
          y: nextLaneY + placement.y,
        }
      ));
    }
    nextLaneY += packedLane.height + LANE_VERTICAL_GAP;
  }

  return flowNodes;
}

/**
 * 为公司关系图生成圆形布局节点。
 * @param visibleNodes 当前可见公司节点。
 * @returns React Flow 节点列表。
 */
function buildCompanyNodes(
  visibleNodes: ResearchNode[]
): Node<CanvasNodeData>[] {
  const centerX = 720;
  const centerY = 360;
  const radius = Math.max(220, visibleNodes.length * 28);
  const sortedNodes = [...visibleNodes].sort(compareResearchNodes);

  return sortedNodes.map((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(sortedNodes.length, 1) - Math.PI / 2;
    const position = {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    };
    return createBaseCircleFlowNode(node, position);
  });
}

/**
 * 计算 React Flow 节点的水平中心点。
 * @param node React Flow 节点。
 * @returns 节点水平中心点。
 */
function getFlowNodeCenterX(node: Node<CanvasNodeData>): number {
  return node.position.x + (node.width || node.measured?.width || 0) / 2;
}

/**
 * 创建可见图谱模型。
 * @param props 图谱数据和当前筛选状态。
 * @returns 可见节点、可见关系和选中状态上下文。
 */
function createVisibleGraphModel({
  snapshot,
  viewMode,
  searchText,
  relationFilter,
}: Pick<
  GraphCanvasProps,
  'snapshot' | 'viewMode' | 'searchText' | 'relationFilter'
>): VisibleGraphModel {
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const viewNodes = snapshot.nodes.filter((node) => nodeBelongsToView(node, viewMode));
  const relationFilteredEdges = snapshot.edges.filter((edge) => (
    (relationFilter === 'all' || edge.relationType === relationFilter)
    && edgeBelongsToView(edge, nodeById, viewMode)
  ));
  const searchedNodeIds = new Set(
    viewNodes
      .filter((node) => matchesSearch(node, searchText))
      .map((node) => node.id)
  );
  const visibleNodeIds = new Set(searchedNodeIds);
  if (searchText.trim()) {
    for (const edge of relationFilteredEdges) {
      if (searchedNodeIds.has(edge.sourceId) || searchedNodeIds.has(edge.targetId)) {
        visibleNodeIds.add(edge.sourceId);
        visibleNodeIds.add(edge.targetId);
      }
    }
  }

  const visibleNodes = viewNodes.filter((node) => visibleNodeIds.has(node.id));
  const visibleNodeIdSet = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = relationFilteredEdges.filter((edge) => (
    visibleNodeIdSet.has(edge.sourceId) && visibleNodeIdSet.has(edge.targetId)
  ));

  return {
    nodeById,
    visibleNodes,
    visibleEdges,
  };
}

/**
 * 创建当前交互状态，供节点和边高亮复用。
 * @param selectedNodeId 当前选中节点 ID。
 * @param visibleNodes 当前可见节点。
 * @param visibleEdges 当前可见关系。
 * @returns 当前节点选中状态和一跳关联节点集合。
 */
function createGraphInteractionState(
  selectedNodeId: string,
  visibleNodes: ResearchNode[],
  visibleEdges: ResearchEdge[]
): GraphInteractionState {
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const hasNodeSelection = Boolean(selectedNodeId && visibleNodeIds.has(selectedNodeId));
  return {
    relatedNodeIds: hasNodeSelection ? collectRelatedNodeIds(selectedNodeId, visibleEdges) : new Set<string>(),
    hasNodeSelection,
  };
}

/**
 * 生成结构布局请求签名，交互高亮变化不会影响该签名。
 * @param graphModel 当前可见图谱模型。
 * @param lanes 当前图谱泳道。
 * @param viewMode 当前视图模式。
 * @returns 用于识别异步布局结果是否过期的签名。
 */
function createLayoutRequestSignature(
  graphModel: VisibleGraphModel,
  lanes: ResearchLane[],
  viewMode: GraphViewMode
): string {
  const laneSignature = lanes.map((lane) => [
    lane.id,
    lane.label,
    lane.color,
    lane.sortOrder,
  ].join(':')).join('|');
  const nodeSignature = graphModel.visibleNodes.map((node) => [
    node.id,
    node.type,
    node.laneId,
    node.weightTier,
    node.sortOrder,
  ].join(':')).join('|');
  const edgeSignature = graphModel.visibleEdges.map((edge) => [
    edge.id,
    edge.sourceId,
    edge.targetId,
  ].join(':')).join('|');
  return [viewMode, laneSignature, nodeSignature, edgeSignature].join('||');
}

/**
 * 将交互高亮状态合并到已有布局节点，避免选中操作重新触发布局。
 * @param layoutNodes 已完成布局的基础节点。
 * @param selectedNodeId 当前选中节点 ID。
 * @param relatedNodeIds 当前选中节点的一跳关联集合。
 * @param hasNodeSelection 当前是否有有效节点选中。
 * @returns 带高亮状态的 React Flow 节点。
 */
function applyNodeInteractionState(
  layoutNodes: Node<CanvasNodeData>[],
  selectedNodeId: string,
  relatedNodeIds: Set<string>,
  hasNodeSelection: boolean
): Node<CanvasNodeData>[] {
  return layoutNodes.map((node) => {
    if (node.type === 'lane') {
      return node;
    }

    const isSelected = node.id === selectedNodeId;
    const isRelated = relatedNodeIds.has(node.id);
    return {
      ...node,
      data: {
        ...node.data,
        isSelected,
        isRelated,
        isDimmed: hasNodeSelection && !isRelated,
      },
    };
  });
}

/**
 * 根据最终节点坐标生成 React Flow 边。
 * @param visibleEdges 当前可见关系。
 * @param nodeById 节点索引。
 * @param flowNodes 已完成布局的 React Flow 节点。
 * @param selectedNodeId 当前选中节点 ID。
 * @param selectedEdgeId 当前选中关系 ID。
 * @returns React Flow 边列表。
 */
function buildEdgeElements(
  visibleEdges: ResearchEdge[],
  nodeById: Map<string, ResearchNode>,
  flowNodes: Node<CanvasNodeData>[],
  selectedNodeId: string,
  selectedEdgeId: string
): Edge<CanvasEdgeData>[] {
  const centerXByNodeId = new Map(
    flowNodes
      .filter((node) => node.type !== 'lane')
      .map((node) => [node.id, getFlowNodeCenterX(node)])
  );

  return visibleEdges.map((edge) => {
    const isSelected = edge.id === selectedEdgeId;
    const isRelated = selectedNodeId
      ? edge.sourceId === selectedNodeId || edge.targetId === selectedNodeId
      : false;
    const statusColor = getStatusColor(edge.status);
    const isDimmed = Boolean(selectedNodeId && !isRelated && !isSelected);
    const sourceNode = nodeById.get(edge.sourceId);
    const targetNode = nodeById.get(edge.targetId);
    const sourceCenterX = centerXByNodeId.get(edge.sourceId) || 0;
    const targetCenterX = centerXByNodeId.get(edge.targetId) || sourceCenterX;
    const sourceBeforeTarget = sourceCenterX <= targetCenterX;

    return {
      id: edge.id,
      source: edge.sourceId,
      target: edge.targetId,
      sourceHandle: sourceBeforeTarget ? 'source-right' : 'source-left',
      targetHandle: sourceBeforeTarget ? 'target-left' : 'target-right',
      type: 'liquid',
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: isDimmed ? '#cbd5e1' : statusColor,
      },
      data: {
        label: `${RELATION_TYPE_LABELS[edge.relationType]} · ${EDGE_STATUS_LABELS[edge.status]}`,
        color: statusColor,
        dashArray: getStatusDash(edge.status),
        strokeWidth: isSelected ? 3.4 : Math.max(1.5, edge.weight * 1.9),
        sourceRadius: sourceNode ? getNodeSize(sourceNode.weightTier) / 2 : 14,
        targetRadius: targetNode ? getNodeSize(targetNode.weightTier) / 2 : 14,
        showLabel: isSelected,
        isSelected,
        isRelated,
        isDimmed,
      },
    };
  });
}

/**
 * 将业务图谱异步转换为 React Flow 节点和边。
 * @param props 图谱数据和当前筛选状态。
 * @returns React Flow 节点与边。
 */
function useFlowElements({
  snapshot,
  viewMode,
  selectedNodeId,
  selectedEdgeId,
  searchText,
  relationFilter,
}: Pick<
  GraphCanvasProps,
  'snapshot' | 'viewMode' | 'selectedNodeId' | 'selectedEdgeId' | 'searchText' | 'relationFilter'
>): FlowElements {
  const graphModel = useMemo(() => createVisibleGraphModel({
    snapshot,
    viewMode,
    searchText,
    relationFilter,
  }), [snapshot, viewMode, searchText, relationFilter]);
  const layoutRequestSignature = useMemo(
    () => createLayoutRequestSignature(graphModel, snapshot.lanes, viewMode),
    [graphModel, snapshot.lanes, viewMode]
  );
  const [layoutState, setLayoutState] = useState<{
    signature: string;
    nodes: Node<CanvasNodeData>[];
  }>({ signature: '', nodes: [] });

  useEffect(() => {
    let isCancelled = false;

    async function applyLayout(): Promise<void> {
      const nodes = viewMode === 'company'
        ? buildCompanyNodes(graphModel.visibleNodes)
        : await buildIndustryNodes(
            graphModel.visibleNodes,
            graphModel.visibleEdges,
            snapshot.lanes
          );
      if (isCancelled) {
        return;
      }

      setLayoutState({ signature: layoutRequestSignature, nodes });
    }

    void applyLayout();
    return () => {
      isCancelled = true;
    };
  }, [graphModel, layoutRequestSignature, snapshot.lanes, viewMode]);

  const layoutNodes = useMemo(
    () => (layoutState.signature === layoutRequestSignature ? layoutState.nodes : []),
    [layoutRequestSignature, layoutState.nodes, layoutState.signature]
  );
  const interactionState = useMemo(
    () => createGraphInteractionState(selectedNodeId, graphModel.visibleNodes, graphModel.visibleEdges),
    [selectedNodeId, graphModel.visibleNodes, graphModel.visibleEdges]
  );
  const nodes = useMemo(
    () => applyNodeInteractionState(
      layoutNodes,
      selectedNodeId,
      interactionState.relatedNodeIds,
      interactionState.hasNodeSelection
    ),
    [interactionState.hasNodeSelection, interactionState.relatedNodeIds, layoutNodes, selectedNodeId]
  );
  const edges = useMemo(
    () => buildEdgeElements(
      graphModel.visibleEdges,
      graphModel.nodeById,
      layoutNodes,
      selectedNodeId,
      selectedEdgeId
    ),
    [graphModel.nodeById, graphModel.visibleEdges, layoutNodes, selectedEdgeId, selectedNodeId]
  );

  return { nodes, edges };
}

/**
 * 生成只描述节点布局的稳定签名。
 * @param nodes React Flow 节点列表。
 * @returns 节点 ID、类型、位置和固定尺寸组成的签名。
 */
function createLayoutSignature(nodes: Node<CanvasNodeData>[]): string {
  return nodes.map((node) => [
    node.id,
    node.type || '',
    node.position.x,
    node.position.y,
    node.width || '',
    node.height || '',
    node.measured?.width || '',
    node.measured?.height || '',
    node.data.size,
    node.style?.width || '',
    node.style?.height || '',
  ].join(':')).join('|');
}

/**
 * Provider 内部的实际 React Flow 画布。
 * @param props 图谱数据、筛选状态和选择回调。
 * @returns 可交互产业链图谱或公司关系图谱。
 */
function GraphCanvasFlow(props: GraphCanvasProps) {
  const { nodes, edges } = useFlowElements(props);
  const { fitView } = useReactFlow();
  const layoutSignature = useMemo(() => createLayoutSignature(nodes), [nodes]);

  useEffect(() => {
    if (!nodes.length) {
      return;
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      void fitView({ padding: 0.04, duration: 180 });
    });

    return () => window.cancelAnimationFrame(animationFrameId);
  }, [fitView, layoutSignature, nodes.length]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.04 }}
      minZoom={0.32}
      maxZoom={1.8}
      onNodeClick={(_, node) => {
        if (node.type !== 'lane') {
          props.onSelectNode(node.id);
        }
      }}
      onPaneClick={() => props.onSelectNode('')}
      onEdgeClick={(_, edge) => props.onSelectEdge(edge.id)}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      onlyRenderVisibleElements
    >
      <Background color="#e2e8f0" gap={26} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

/**
 * 圆点网络图谱画布。
 * @param props 图谱数据、筛选状态和选择回调。
 * @returns 可交互产业链图谱或公司关系图谱。
 */
export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <div className="graphCanvas">
      <ReactFlowProvider>
        <GraphCanvasFlow {...props} />
      </ReactFlowProvider>
    </div>
  );
}
