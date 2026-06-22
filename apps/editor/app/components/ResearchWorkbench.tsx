'use client';

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Download,
  GitBranch,
  GripVertical,
  Layers,
  Network,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Trash2,
  Upload,
} from 'lucide-react';
import { DetailPanel } from './DetailPanel';
import { GraphCanvas } from './GraphCanvas';
import { NodeSearchSelect } from './NodeSearchSelect';
import {
  EDGE_STATUS_DESCRIPTIONS,
  EDGE_STATUS_LABELS,
  formatDescribedOption,
  getNodeWeightTierDescription,
  getNodeWeightTierLabel,
  NODE_TYPE_DESCRIPTIONS,
  NODE_TYPE_LABELS,
  RELATION_TYPE_DESCRIPTIONS,
  RELATION_TYPE_LABELS,
} from '@/app/lib/graph-labels';
import { getTickerPlaceholder, normalizeTickerForMarket, STOCK_MARKETS } from '@/app/lib/market-rules';
import {
  EDGE_STATUSES,
  EdgeStatus,
  EdgeInput,
  GraphAuthoringDocument,
  GraphInput,
  GraphImportResult,
  GraphImportValidationIssue,
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
} from '@/app/lib/graph-types';

type WorkbenchView = 'industry' | 'company';
type LaneMoveDirection = 'up' | 'down';

const EMPTY_SNAPSHOT: GraphSnapshot = {
  graphs: [],
  currentGraphId: '',
  lanes: [],
  nodes: [],
  edges: [],
};

interface LaneEditorRowProps {
  lane: ResearchLane;
  isFirst: boolean;
  isLast: boolean;
  isDragging: boolean;
  isDragTarget: boolean;
  onUpdateLane: (laneId: string, input: Partial<LaneInput>) => Promise<void>;
  onDeleteLane: (laneId: string) => Promise<void>;
  onMoveLane: (laneId: string, direction: LaneMoveDirection) => Promise<void>;
  onDragStartLane: (laneId: string) => void;
  onDragEnterLane: (laneId: string) => void;
  onDragEndLane: () => void;
  onDropLane: (sourceLaneId: string, targetLaneId: string) => Promise<void>;
}

interface GraphSelectProps {
  graphs: IndustryGraph[];
  currentGraphId: string;
  onSelectGraph: (graphId: string) => void;
  onDeleteGraph: (graphId: string) => Promise<void>;
  isDisabled: boolean;
}

interface ApiErrorPayload {
  error?: unknown;
  message?: unknown;
  errors?: unknown;
}

/**
 * 创建空节点表单。
 * @returns 节点输入草稿。
 */
function createEmptyNodeDraft(): NodeInput {
  return {
    type: 'concept',
    weightTier: 'medium',
    laneId: '',
    label: '',
    summary: '',
    ticker: '',
    market: '',
  };
}

/**
 * 创建空关系表单。
 * @param snapshot 当前图谱快照。
 * @returns 关系输入草稿。
 */
function createEmptyEdgeDraft(snapshot: GraphSnapshot): EdgeInput {
  return {
    sourceId: snapshot.nodes[0]?.id || '',
    targetId: snapshot.nodes[1]?.id || '',
    relationType: 'contains',
    status: 'unverified',
    note: '',
  };
}

/**
 * 创建空泳道表单。
 * @returns 泳道输入草稿。
 */
function createEmptyLaneDraft(): LaneInput {
  return {
    label: '',
    color: '#2563eb',
  };
}

/**
 * 创建空图谱表单。
 * @returns 图谱输入草稿。
 */
function createEmptyGraphDraft(): GraphInput {
  return {
    label: '',
    summary: '',
  };
}

/**
 * 获取产业链视图默认聚焦节点。
 * @param snapshot 当前图谱快照。
 * @returns 默认节点 ID。
 */
function getDefaultIndustryNodeId(snapshot: GraphSnapshot): string {
  const currentGraph = snapshot.graphs.find((graph) => graph.id === snapshot.currentGraphId);
  return snapshot.nodes.find((node) => node.label === currentGraph?.label && node.type === 'narrative')?.id
    || snapshot.nodes.find((node) => node.id === 'narrative-ai-server')?.id
    || snapshot.nodes.find((node) => node.type !== 'company')?.id
    || snapshot.nodes[0]?.id
    || '';
}

/**
 * 按泳道顺序字段排序。
 * @param lanes 泳道列表。
 * @returns 排序后的泳道列表。
 */
function sortLanes(lanes: ResearchLane[]): ResearchLane[] {
  return [...lanes].sort((leftLane, rightLane) => (
    leftLane.sortOrder - rightLane.sortOrder || leftLane.label.localeCompare(rightLane.label, 'zh-CN')
  ));
}

/**
 * 生成可编辑格式下载文件名。
 * @param document 可编辑图谱文档。
 * @returns JSON 文件名。
 */
function createAuthoringDownloadName(document: GraphAuthoringDocument): string {
  const safeGraphLabel = document.graph.label.replace(/[^A-Za-z0-9\u4e00-\u9fff._-]+/g, '-');
  const dateText = new Date().toISOString().slice(0, 10);
  return `${safeGraphLabel || 'research-graph'}-editable-${dateText}.json`;
}

/**
 * 生成静态分享 HTML 下载文件名。
 * @param graphLabel 产业图谱名称。
 * @returns HTML 文件名。
 */
function createShareHtmlDownloadName(graphLabel: string): string {
  const safeGraphLabel = graphLabel.replace(/[^A-Za-z0-9\u4e00-\u9fff._-]+/g, '-');
  const dateText = new Date().toISOString().slice(0, 10);
  return `${safeGraphLabel || 'research-graph'}-share-${dateText}.html`;
}

/**
 * 从 API 错误响应中生成错误详情。
 * @param payload API 错误响应。
 * @returns 可展示错误文本。
 */
function formatApiErrorMessage(payload: ApiErrorPayload): string {
  const message = typeof payload.message === 'string'
    ? payload.message
    : typeof payload.error === 'string'
      ? payload.error
      : '请求失败';
  if (!Array.isArray(payload.errors)) {
    return message;
  }

  const issues = payload.errors.filter((issue): issue is GraphImportValidationIssue => (
    typeof issue === 'object'
    && issue !== null
    && 'path' in issue
    && 'message' in issue
    && typeof issue.path === 'string'
    && typeof issue.message === 'string'
  ));
  if (issues.length === 0) {
    return message;
  }

  const issueText = issues
    .slice(0, 8)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join('\n');
  const omittedText = issues.length > 8 ? `\n另有 ${issues.length - 8} 处错误` : '';
  return `${message}\n${issueText}${omittedText}`;
}

/**
 * 图谱选择器。
 * @param props 图谱列表、当前图谱和选择回调。
 * @returns 当前产业图谱选择控件。
 */
function GraphSelect({ graphs, currentGraphId, onSelectGraph, onDeleteGraph, isDisabled }: GraphSelectProps) {
  const currentGraph = graphs.find((graph) => graph.id === currentGraphId);
  const canDeleteGraph = Boolean(currentGraphId) && graphs.length > 1 && !isDisabled;

  return (
    <div className="graphSelectControl">
      <label>
        <span>当前产业图谱</span>
        <select
          value={currentGraphId}
          disabled={isDisabled || graphs.length === 0}
          onChange={(event) => onSelectGraph(event.target.value)}
        >
          {graphs.map((graph) => (
            <option key={graph.id} value={graph.id}>{graph.label}</option>
          ))}
        </select>
      </label>
      <button
        className="iconDangerButton"
        type="button"
        title={graphs.length <= 1 ? '至少保留一个产业图谱' : '删除当前图谱'}
        aria-label="删除当前图谱"
        disabled={!canDeleteGraph}
        onClick={() => {
          if (!currentGraph) {
            return;
          }
          const confirmed = window.confirm(
            `确认删除图谱「${currentGraph.label}」？该图谱内泳道、关系和未被其他图谱引用的节点都会删除。`
          );
          if (confirmed) {
            void onDeleteGraph(currentGraph.id);
          }
        }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

/**
 * 单条泳道编辑行。
 * @param props 泳道和泳道 CRUD 回调。
 * @returns 泳道改名、改色、移动和删除控件。
 */
function LaneEditorRow({
  lane,
  isFirst,
  isLast,
  isDragging,
  isDragTarget,
  onUpdateLane,
  onDeleteLane,
  onMoveLane,
  onDragStartLane,
  onDragEnterLane,
  onDragEndLane,
  onDropLane,
}: LaneEditorRowProps) {
  const [draft, setDraft] = useState<LaneInput>({
    label: lane.label,
    color: lane.color,
  });

  /**
   * 保存泳道编辑。
   * @param event 表单提交事件。
   */
  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await onUpdateLane(lane.id, draft);
  }

  return (
    <form
      className={[
        'laneEditorRow',
        isDragging ? 'dragging' : '',
        isDragTarget ? 'dragTarget' : '',
      ].filter(Boolean).join(' ')}
      onSubmit={handleSubmit}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDragEnter={() => onDragEnterLane(lane.id)}
      onDrop={(event) => {
        event.preventDefault();
        const sourceLaneId = event.dataTransfer.getData('text/plain');
        if (sourceLaneId) {
          void onDropLane(sourceLaneId, lane.id);
        }
      }}
    >
      <button
        className="iconButton dragHandle"
        type="button"
        title="拖动调整泳道顺序"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', lane.id);
          onDragStartLane(lane.id);
        }}
        onDragEnd={onDragEndLane}
      >
        <GripVertical size={15} />
      </button>
      <input
        value={draft.label}
        aria-label={`${lane.label} 名称`}
        onChange={(event) => setDraft({ ...draft, label: event.target.value })}
      />
      <input
        type="color"
        value={draft.color || '#2563eb'}
        aria-label={`${lane.label} 颜色`}
        onChange={(event) => setDraft({ ...draft, color: event.target.value })}
      />
      <button
        className="iconButton"
        type="button"
        title="上移泳道"
        disabled={isFirst}
        onClick={() => void onMoveLane(lane.id, 'up')}
      >
        <ArrowUp size={14} />
      </button>
      <button
        className="iconButton"
        type="button"
        title="下移泳道"
        disabled={isLast}
        onClick={() => void onMoveLane(lane.id, 'down')}
      >
        <ArrowDown size={14} />
      </button>
      <button className="iconButton" type="submit" title="保存泳道">
        <Check size={14} />
      </button>
      <button
        className="iconDangerButton"
        type="button"
        title="删除泳道"
        onClick={() => {
          if (window.confirm(`确认删除泳道「${lane.label}」？节点会变为未配置泳道。`)) {
            void onDeleteLane(lane.id);
          }
        }}
      >
        <Trash2 size={14} />
      </button>
    </form>
  );
}

/**
 * 调用 JSON API 并统一处理错误信息。
 * @param url API 地址。
 * @param options fetch 请求配置。
 * @returns 解析后的 JSON 数据。
 */
async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({})) as ApiErrorPayload;
  if (!response.ok) {
    throw new Error(formatApiErrorMessage(payload));
  }
  return payload as T;
}

/**
 * 产研图谱主工作台。
 * @returns 图谱查看、矩阵分析和 CRUD 操作界面。
 */
export function ResearchWorkbench() {
  const [snapshot, setSnapshot] = useState<GraphSnapshot>(EMPTY_SNAPSHOT);
  const [selectedGraphId, setSelectedGraphId] = useState('');
  const [view, setView] = useState<WorkbenchView>('industry');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [selectedEdgeId, setSelectedEdgeId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [relationFilter, setRelationFilter] = useState<RelationType | 'all'>('all');
  const [nodeDraft, setNodeDraft] = useState<NodeInput>(createEmptyNodeDraft());
  const [edgeDraft, setEdgeDraft] = useState<EdgeInput>(createEmptyEdgeDraft(EMPTY_SNAPSHOT));
  const [laneDraft, setLaneDraft] = useState<LaneInput>(createEmptyLaneDraft());
  const [graphDraft, setGraphDraft] = useState<GraphInput>(createEmptyGraphDraft());
  const [draggingLaneId, setDraggingLaneId] = useState('');
  const [dragTargetLaneId, setDragTargetLaneId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const importFileInputRef = useRef<HTMLInputElement>(null);

  const nodeById = useMemo(
    () => new Map(snapshot.nodes.map((node) => [node.id, node])),
    [snapshot.nodes]
  );
  const companyCount = snapshot.nodes.filter((node) => node.type === 'company').length;
  const conceptCount = snapshot.nodes.filter((node) => node.type !== 'company').length;
  const companyEdgeCount = snapshot.edges.filter((edge) => {
    const sourceNode = nodeById.get(edge.sourceId);
    const targetNode = nodeById.get(edge.targetId);
    return sourceNode?.type === 'company' && targetNode?.type === 'company';
  }).length;
  const orderedLanes = useMemo(() => sortLanes(snapshot.lanes), [snapshot.lanes]);

  /**
   * 从服务端重新加载完整图谱快照。
   * @param graphId 指定产业图谱 ID。
   */
  const loadGraph = useCallback(async (graphId?: string): Promise<void> => {
    try {
      setIsLoading(true);
      const targetGraphId = graphId || selectedGraphId;
      const queryString = targetGraphId ? `?graphId=${encodeURIComponent(targetGraphId)}` : '';
      const nextSnapshot = await requestJson<GraphSnapshot>(`/api/graph${queryString}`, {
        method: 'GET',
        cache: 'no-store',
      });
      setSnapshot(nextSnapshot);
      setSelectedGraphId(nextSnapshot.currentGraphId);
      setEdgeDraft((currentDraft) => (
        currentDraft.sourceId && currentDraft.targetId
          ? currentDraft
          : createEmptyEdgeDraft(nextSnapshot)
      ));
      setSelectedNodeId((currentNodeId) => currentNodeId || getDefaultIndustryNodeId(nextSnapshot));
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '加载图谱失败');
    } finally {
      setIsLoading(false);
    }
  }, [selectedGraphId]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void loadGraph();
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [loadGraph]);

  /**
   * 执行写入操作并在成功后刷新图谱。
   * @param action 写入动作。
   */
  async function runMutation(action: () => Promise<void>): Promise<void> {
    try {
      setIsSaving(true);
      await action();
      await loadGraph();
      setErrorMessage('');
      setStatusMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '保存失败');
    } finally {
      setIsSaving(false);
    }
  }

  /**
   * 创建节点。
   * @param event 表单提交事件。
   */
  async function handleCreateNode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await runMutation(async () => {
      const node = await requestJson<ResearchNode>('/api/nodes', {
        method: 'POST',
        body: JSON.stringify({
          ...nodeDraft,
          graphId: selectedGraphId,
          laneId: nodeDraft.laneId,
          market: nodeDraft.type === 'company' ? nodeDraft.market : '',
          ticker: nodeDraft.type === 'company' ? nodeDraft.ticker : '',
        }),
      });
      setSelectedNodeId(node.id);
      setSelectedEdgeId('');
      setNodeDraft(createEmptyNodeDraft());
    });
  }

  /**
   * 创建产业链泳道。
   * @param event 表单提交事件。
   */
  async function handleCreateLane(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await runMutation(async () => {
      await requestJson('/api/lanes', {
        method: 'POST',
        body: JSON.stringify({ ...laneDraft, graphId: selectedGraphId }),
      });
      setLaneDraft(createEmptyLaneDraft());
    });
  }

  /**
   * 创建产业图谱。
   * @param event 表单提交事件。
   */
  async function handleCreateGraph(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    try {
      setIsSaving(true);
      const graph = await requestJson<IndustryGraph>('/api/graphs', {
        method: 'POST',
        body: JSON.stringify(graphDraft),
      });
      setGraphDraft(createEmptyGraphDraft());
      setSelectedGraphId(graph.id);
      await loadGraph(graph.id);
      setErrorMessage('');
      setStatusMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '创建图谱失败');
    } finally {
      setIsSaving(false);
    }
  }

  /**
   * 删除当前产业图谱并切换到剩余图谱。
   * @param graphId 图谱 ID。
   */
  async function deleteGraph(graphId: string): Promise<void> {
    const graph = snapshot.graphs.find((item) => item.id === graphId);
    const fallbackGraph = snapshot.graphs.find((item) => item.id !== graphId);
    if (!fallbackGraph) {
      setErrorMessage('至少保留一个产业图谱');
      return;
    }

    try {
      setIsSaving(true);
      await requestJson<{ success: boolean }>(`/api/graphs/${encodeURIComponent(graphId)}`, {
        method: 'DELETE',
      });
      setSelectedGraphId(fallbackGraph.id);
      setSelectedNodeId('');
      setSelectedEdgeId('');
      await loadGraph(fallbackGraph.id);
      setStatusMessage(`已删除图谱「${graph?.label || graphId}」`);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '删除图谱失败');
    } finally {
      setIsSaving(false);
    }
  }

  /**
   * 导出当前产业图谱 JSON 文件。
   */
  async function exportCurrentGraph(): Promise<void> {
    const graphId = selectedGraphId || snapshot.currentGraphId;
    if (!graphId) {
      setErrorMessage('请先选择要导出的产业图谱');
      return;
    }

    try {
      setIsSaving(true);
      const exportDocument = await requestJson<GraphAuthoringDocument>(
        `/api/graph/export?graphId=${encodeURIComponent(graphId)}`,
        {
          method: 'GET',
          cache: 'no-store',
        }
      );
      const blob = new Blob([JSON.stringify(exportDocument, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const objectUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = createAuthoringDownloadName(exportDocument);
      anchor.click();
      window.URL.revokeObjectURL(objectUrl);
      setStatusMessage(`已导出可编辑 JSON「${exportDocument.graph.label}」`);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '导出图谱失败');
    } finally {
      setIsSaving(false);
    }
  }

  /**
   * 导出当前产业图谱的静态分享 HTML 文件。
   */
  async function exportShareHtml(): Promise<void> {
    const graphId = selectedGraphId || snapshot.currentGraphId;
    if (!graphId) {
      setErrorMessage('请先选择要导出的产业图谱');
      return;
    }

    try {
      setIsSaving(true);
      const response = await fetch(`/api/graph/share?graphId=${encodeURIComponent(graphId)}`, {
        method: 'GET',
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as ApiErrorPayload;
        throw new Error(formatApiErrorMessage(payload));
      }

      const graph = snapshot.graphs.find((item) => item.id === graphId);
      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = createShareHtmlDownloadName(graph?.label || 'research-graph');
      anchor.click();
      window.URL.revokeObjectURL(objectUrl);
      setStatusMessage(`已导出分享 HTML「${graph?.label || graphId}」`);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '导出分享 HTML 失败');
    } finally {
      setIsSaving(false);
    }
  }

  /**
   * 导入单个产业图谱 JSON 文件。
   * @param event 文件选择事件。
   */
  async function importGraphFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    try {
      const rawText = await file.text();
      setIsSaving(true);
      const result = await requestJson<GraphImportResult>('/api/graph/import', {
        method: 'POST',
        body: rawText,
      });
      setSelectedGraphId(result.graphId);
      setSelectedNodeId('');
      setSelectedEdgeId('');
      await loadGraph(result.graphId);
      setStatusMessage(
        `已导入图谱「${result.graphLabel}」：${result.nodes} 个节点，${result.edges} 条关系`
      );
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '导入图谱失败');
    } finally {
      setIsSaving(false);
    }
  }

  /**
   * 更新产业链泳道。
   * @param laneId 泳道 ID。
   * @param input 泳道更新字段。
   */
  async function updateLane(laneId: string, input: Partial<LaneInput>): Promise<void> {
    await runMutation(async () => {
      await requestJson(`/api/lanes/${encodeURIComponent(laneId)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
    });
  }

  /**
   * 保存泳道顺序。
   * @param orderedLaneIds 按目标顺序排列的泳道 ID。
   */
  async function saveLaneOrder(orderedLaneIds: string[]): Promise<void> {
    const laneById = new Map(snapshot.lanes.map((lane) => [lane.id, lane]));
    await runMutation(async () => {
      await Promise.all(orderedLaneIds.map((laneId, index) => {
        const lane = laneById.get(laneId);
        const sortOrder = (index + 1) * 10;
        if (!lane || lane.sortOrder === sortOrder) {
          return Promise.resolve();
        }
        return requestJson<ResearchLane>(`/api/lanes/${encodeURIComponent(laneId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ sortOrder }),
        });
      }));
    });
  }

  /**
   * 按方向移动泳道。
   * @param laneId 泳道 ID。
   * @param direction 移动方向。
   */
  async function moveLane(laneId: string, direction: LaneMoveDirection): Promise<void> {
    const currentIndex = orderedLanes.findIndex((lane) => lane.id === laneId);
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedLanes.length) {
      return;
    }

    const nextLanes = [...orderedLanes];
    [nextLanes[currentIndex], nextLanes[targetIndex]] = [nextLanes[targetIndex], nextLanes[currentIndex]];
    await saveLaneOrder(nextLanes.map((lane) => lane.id));
  }

  /**
   * 将拖动的泳道放到目标泳道位置。
   * @param sourceLaneId 被拖动的泳道 ID。
   * @param targetLaneId 放置目标泳道 ID。
   */
  async function dropLane(sourceLaneId: string, targetLaneId: string): Promise<void> {
    setDraggingLaneId('');
    setDragTargetLaneId('');
    if (!sourceLaneId || sourceLaneId === targetLaneId) {
      return;
    }

    const sourceIndex = orderedLanes.findIndex((lane) => lane.id === sourceLaneId);
    const targetIndex = orderedLanes.findIndex((lane) => lane.id === targetLaneId);
    if (sourceIndex < 0 || targetIndex < 0) {
      return;
    }

    const nextLanes = [...orderedLanes];
    const [sourceLane] = nextLanes.splice(sourceIndex, 1);
    nextLanes.splice(targetIndex, 0, sourceLane);
    await saveLaneOrder(nextLanes.map((lane) => lane.id));
  }

  /**
   * 删除产业链泳道。
   * @param laneId 泳道 ID。
   */
  async function deleteLane(laneId: string): Promise<void> {
    await runMutation(async () => {
      await requestJson<{ success: boolean }>(`/api/lanes/${encodeURIComponent(laneId)}`, {
        method: 'DELETE',
      });
    });
  }

  /**
   * 创建关系。
   * @param event 表单提交事件。
   */
  async function handleCreateEdge(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await createEdge(edgeDraft);
  }

  /**
   * 创建关系并选中。
   * @param input 关系输入信息。
   */
  async function createEdge(input: EdgeInput): Promise<void> {
    await runMutation(async () => {
      const edge = await requestJson<ResearchEdge>('/api/edges', {
        method: 'POST',
        body: JSON.stringify({ ...input, graphId: selectedGraphId }),
      });
      setSelectedEdgeId(edge.id);
      setEdgeDraft({ ...input, note: '' });
    });
  }

  /**
   * 更新节点。
   * @param nodeId 节点 ID。
   * @param input 节点更新字段。
   */
  async function updateNode(nodeId: string, input: Partial<NodeInput>): Promise<void> {
    await runMutation(async () => {
      await requestJson<ResearchNode>(`/api/nodes/${encodeURIComponent(nodeId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...input, graphId: selectedGraphId }),
      });
    });
  }

  /**
   * 删除节点。
   * @param nodeId 节点 ID。
   */
  async function deleteNode(nodeId: string): Promise<void> {
    await runMutation(async () => {
      await requestJson<{ success: boolean }>(`/api/nodes/${encodeURIComponent(nodeId)}`, {
        method: 'DELETE',
      });
      if (selectedNodeId === nodeId) {
        setSelectedNodeId('');
      }
      setSelectedEdgeId('');
    });
  }

  /**
   * 更新关系。
   * @param edgeId 关系 ID。
   * @param input 关系更新字段。
   */
  async function updateEdge(edgeId: string, input: Partial<EdgeInput>): Promise<void> {
    await runMutation(async () => {
      await requestJson<ResearchEdge>(`/api/edges/${encodeURIComponent(edgeId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...input, graphId: selectedGraphId }),
      });
    });
  }

  /**
   * 删除关系。
   * @param edgeId 关系 ID。
   */
  async function deleteEdge(edgeId: string): Promise<void> {
    await runMutation(async () => {
      await requestJson<{ success: boolean }>(`/api/edges/${encodeURIComponent(edgeId)}`, {
        method: 'DELETE',
      });
      if (selectedEdgeId === edgeId) {
        setSelectedEdgeId('');
      }
    });
  }

  /**
   * 选中节点并清空关系选中状态。
   * @param nodeId 节点 ID，空字符串表示取消节点选择。
   */
  function handleSelectNode(nodeId: string): void {
    setSelectedNodeId(nodeId);
    setSelectedEdgeId('');
  }

  /**
   * 选中关系并清空节点选中状态。
   * @param edgeId 关系 ID，空字符串表示取消关系选择。
   */
  function handleSelectEdge(edgeId: string): void {
    setSelectedEdgeId(edgeId);
    setSelectedNodeId('');
  }

  return (
    <main className="workbenchShell">
      <header className="topBar">
        <div>
          <p className="eyebrow">Research Graph</p>
          <h1>股市产研图谱</h1>
        </div>
        <div className="topStats">
          <span>{conceptCount} 个产业/概念节点</span>
          <span>{companyCount} 家公司</span>
          <span>{companyEdgeCount} 条公司关系</span>
          <span>{snapshot.lanes.length} 条泳道</span>
          <button className="ghostButton" type="button" onClick={() => void loadGraph()}>
            <RefreshCw size={16} />
            刷新
          </button>
        </div>
      </header>

      {errorMessage && <div className="errorBanner">{errorMessage}</div>}
      {statusMessage && !errorMessage && <div className="statusBanner">{statusMessage}</div>}

      <div className="workbenchGrid">
        <aside className="leftPanel">
          <section className="panelSection">
            <div className="sectionHeader">
              <h2>检索与视图</h2>
            </div>
            <GraphSelect
              graphs={snapshot.graphs}
              currentGraphId={selectedGraphId || snapshot.currentGraphId}
              isDisabled={isLoading || isSaving}
              onSelectGraph={(graphId) => {
                setSelectedGraphId(graphId);
                setSelectedNodeId('');
                setSelectedEdgeId('');
                void loadGraph(graphId);
              }}
              onDeleteGraph={deleteGraph}
            />
            <label className="searchBox">
              <Search size={16} />
              <input
                value={searchText}
                placeholder="搜索概念、公司、代码"
                onChange={(event) => setSearchText(event.target.value)}
              />
            </label>
            <div className="segmentedControl">
              <button
                className={view === 'industry' ? 'active' : ''}
                type="button"
                onClick={() => {
                  setView('industry');
                  setSelectedNodeId((currentNodeId) => {
                    const currentNode = nodeById.get(currentNodeId);
                    return currentNode
                      ? currentNodeId
                      : getDefaultIndustryNodeId(snapshot);
                  });
                }}
              >
                <GitBranch size={15} />
                产业链
              </button>
              <button
                className={view === 'company' ? 'active' : ''}
                type="button"
                onClick={() => {
                  setView('company');
                  setSelectedNodeId((currentNodeId) => {
                    const currentNode = nodeById.get(currentNodeId);
                    return currentNode?.type === 'company' ? currentNodeId : '';
                  });
                }}
              >
                <Network size={15} />
                公司关系
              </button>
            </div>
            <label>
              <span>关系筛选</span>
              <select
                value={relationFilter}
                onChange={(event) => setRelationFilter(event.target.value as RelationType | 'all')}
              >
                <option value="all">全部关系</option>
                {RELATION_TYPES.map((relationType) => (
                  <option key={relationType} value={relationType}>
                    {RELATION_TYPE_LABELS[relationType]}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="panelSection">
            <div className="sectionHeader">
              <h2>导入导出</h2>
            </div>
            <input
              ref={importFileInputRef}
              className="hiddenFileInput"
              type="file"
              accept="application/json,.json"
              onChange={(event) => void importGraphFile(event)}
            />
            <div className="importExportActions">
              <button
                className="secondaryButton"
                type="button"
                disabled={isLoading || isSaving || !selectedGraphId}
                onClick={() => void exportCurrentGraph()}
              >
                <Download size={16} />
                导出可编辑 JSON
              </button>
              <button
                className="secondaryButton"
                type="button"
                disabled={isLoading || isSaving || !selectedGraphId}
                onClick={() => void exportShareHtml()}
              >
                <Share2 size={16} />
                导出分享 HTML
              </button>
              <button
                className="secondaryButton"
                type="button"
                disabled={isLoading || isSaving}
                onClick={() => importFileInputRef.current?.click()}
              >
                <Upload size={16} />
                导入 JSON
              </button>
            </div>
          </section>

          <section className="panelSection">
            <div className="sectionHeader">
              <h2>新增图谱</h2>
            </div>
            <form className="stackForm" onSubmit={handleCreateGraph}>
              <input
                value={graphDraft.label}
                placeholder="图谱名称，如 低空经济 / 半导体设备"
                onChange={(event) => setGraphDraft({ ...graphDraft, label: event.target.value })}
              />
              <textarea
                value={graphDraft.summary || ''}
                rows={2}
                placeholder="图谱说明"
                onChange={(event) => setGraphDraft({ ...graphDraft, summary: event.target.value })}
              />
              <button className="secondaryButton" type="submit" disabled={isSaving}>
                <Plus size={16} />
                新增图谱
              </button>
            </form>
          </section>

          <section className="panelSection">
            <div className="sectionHeader">
              <h2>新增泳道</h2>
            </div>
            <form className="stackForm" onSubmit={handleCreateLane}>
              <input
                value={laneDraft.label}
                placeholder="泳道名称，如 封测 / 厂房 / 云"
                onChange={(event) => setLaneDraft({ ...laneDraft, label: event.target.value })}
              />
              <input
                type="color"
                value={laneDraft.color || '#2563eb'}
                aria-label="泳道颜色"
                onChange={(event) => setLaneDraft({ ...laneDraft, color: event.target.value })}
              />
              <button className="secondaryButton" type="submit" disabled={isSaving}>
                <Layers size={16} />
                新增泳道
              </button>
            </form>
            <div className="laneList">
              {orderedLanes.map((lane, index) => (
                <LaneEditorRow
                  key={lane.id}
                  lane={lane}
                  isFirst={index === 0}
                  isLast={index === orderedLanes.length - 1}
                  isDragging={draggingLaneId === lane.id}
                  isDragTarget={Boolean(draggingLaneId) && dragTargetLaneId === lane.id && draggingLaneId !== lane.id}
                  onUpdateLane={updateLane}
                  onDeleteLane={deleteLane}
                  onMoveLane={moveLane}
                  onDragStartLane={setDraggingLaneId}
                  onDragEnterLane={setDragTargetLaneId}
                  onDragEndLane={() => {
                    setDraggingLaneId('');
                    setDragTargetLaneId('');
                  }}
                  onDropLane={dropLane}
                />
              ))}
            </div>
          </section>

          <section className="panelSection">
            <div className="sectionHeader">
              <h2>新增节点</h2>
            </div>
            <form className="stackForm" onSubmit={handleCreateNode}>
              <input
                value={nodeDraft.label}
                placeholder="节点名称，如 PCB / 沪电股份"
                onChange={(event) => setNodeDraft({ ...nodeDraft, label: event.target.value })}
              />
              <label>
                <span>节点类型</span>
                <select
                  value={nodeDraft.type}
                  onChange={(event) => setNodeDraft({
                    ...nodeDraft,
                    type: event.target.value as ResearchNodeType,
                    market: event.target.value === 'company' ? nodeDraft.market : '',
                    ticker: event.target.value === 'company' ? nodeDraft.ticker : '',
                  })}
                >
                  {NODE_TYPES.map((nodeType) => (
                    <option key={nodeType} value={nodeType}>
                      {formatDescribedOption(NODE_TYPE_LABELS[nodeType], NODE_TYPE_DESCRIPTIONS[nodeType])}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>节点权重</span>
                <select
                  value={nodeDraft.weightTier || 'medium'}
                  onChange={(event) => setNodeDraft({
                    ...nodeDraft,
                    weightTier: event.target.value as NodeWeightTier,
                  })}
                >
                  {NODE_WEIGHT_TIERS.map((weightTier) => (
                    <option key={weightTier} value={weightTier}>
                      {formatDescribedOption(
                        getNodeWeightTierLabel(nodeDraft.type, weightTier),
                        getNodeWeightTierDescription(nodeDraft.type, weightTier)
                      )}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>所属泳道</span>
                <select
                  value={nodeDraft.laneId || ''}
                  onChange={(event) => setNodeDraft({ ...nodeDraft, laneId: event.target.value })}
                >
                  <option value="">不配置泳道</option>
                  {orderedLanes.map((lane) => (
                    <option key={lane.id} value={lane.id}>{lane.label}</option>
                  ))}
                </select>
              </label>
              {nodeDraft.type === 'company' && (
                <div className="formGrid2">
                  <label>
                    <span>上市市场</span>
                    <select
                      value={nodeDraft.market || ''}
                      onChange={(event) => setNodeDraft({
                        ...nodeDraft,
                        market: event.target.value,
                        ticker: normalizeTickerForMarket(event.target.value, nodeDraft.ticker),
                      })}
                    >
                      <option value="">选择市场</option>
                      {STOCK_MARKETS.map((market) => (
                        <option key={market} value={market}>{market}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>证券代码</span>
                    <input
                      value={nodeDraft.ticker || ''}
                      placeholder={getTickerPlaceholder(nodeDraft.market)}
                      onChange={(event) => setNodeDraft({
                        ...nodeDraft,
                        ticker: normalizeTickerForMarket(nodeDraft.market, event.target.value),
                      })}
                    />
                  </label>
                </div>
              )}
              <textarea
                value={nodeDraft.summary || ''}
                rows={3}
                placeholder="简要说明"
                onChange={(event) => setNodeDraft({ ...nodeDraft, summary: event.target.value })}
              />
              <button className="primaryButton" type="submit" disabled={isSaving}>
                <Plus size={16} />
                新增节点
              </button>
            </form>
          </section>

          <section className="panelSection">
            <div className="sectionHeader">
              <h2>新增关系</h2>
            </div>
            <form className="stackForm" onSubmit={handleCreateEdge}>
              <NodeSearchSelect
                label="来源"
                nodes={snapshot.nodes}
                selectedNodeId={edgeDraft.sourceId}
                excludeNodeId={edgeDraft.targetId}
                onSelectNode={(nodeId) => setEdgeDraft({ ...edgeDraft, sourceId: nodeId })}
              />
              <NodeSearchSelect
                label="目标"
                nodes={snapshot.nodes}
                selectedNodeId={edgeDraft.targetId}
                excludeNodeId={edgeDraft.sourceId}
                onSelectNode={(nodeId) => setEdgeDraft({ ...edgeDraft, targetId: nodeId })}
              />
              <label>
                <span>关系类型</span>
                <select
                  value={edgeDraft.relationType}
                  onChange={(event) => setEdgeDraft({
                    ...edgeDraft,
                    relationType: event.target.value as RelationType,
                  })}
                >
                  {RELATION_TYPES.map((relationType) => (
                    <option key={relationType} value={relationType}>
                      {formatDescribedOption(RELATION_TYPE_LABELS[relationType], RELATION_TYPE_DESCRIPTIONS[relationType])}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>关系状态</span>
                <select
                  value={edgeDraft.status}
                  onChange={(event) => setEdgeDraft({
                    ...edgeDraft,
                    status: event.target.value as EdgeStatus,
                  })}
                >
                  {EDGE_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {formatDescribedOption(EDGE_STATUS_LABELS[status], EDGE_STATUS_DESCRIPTIONS[status])}
                    </option>
                  ))}
                </select>
              </label>
              <textarea
                value={edgeDraft.note || ''}
                rows={2}
                placeholder="关系备注"
                onChange={(event) => setEdgeDraft({ ...edgeDraft, note: event.target.value })}
              />
              <button className="secondaryButton" type="submit" disabled={isSaving}>
                <Plus size={16} />
                新增关系
              </button>
            </form>
          </section>
        </aside>

        <section className="mainPanel">
          <div className="mainToolbar">
            <div>
              <h2>{view === 'company' ? '公司关系图谱' : '产业链图谱'}</h2>
              <p>
                {selectedNodeId
                  ? `当前焦点：${nodeById.get(selectedNodeId)?.label || '未选择'}`
                  : view === 'company'
                    ? `当前背景：${snapshot.graphs.find((graph) => graph.id === snapshot.currentGraphId)?.label || '未选择'}，选择公司圆点后高亮它的一跳公司关系`
                    : '选择产业环节或公司后高亮一跳关联，公司间关系保留在公司关系视图'}
              </p>
            </div>
            {(isLoading || isSaving) && <span className="savingBadge">同步中</span>}
          </div>

          <GraphCanvas
            snapshot={snapshot}
            viewMode={view}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            searchText={searchText}
            relationFilter={relationFilter}
            onSelectNode={handleSelectNode}
            onSelectEdge={handleSelectEdge}
          />
        </section>

        <DetailPanel
          snapshot={snapshot}
          view={view}
          selectedNodeId={selectedNodeId}
          selectedEdgeId={selectedEdgeId}
          onSelectNode={handleSelectNode}
          onUpdateNode={updateNode}
          onDeleteNode={deleteNode}
          onUpdateEdge={updateEdge}
          onDeleteEdge={deleteEdge}
        />
      </div>
    </main>
  );
}
