'use client';

import { FormEvent, useMemo, useState } from 'react';
import { Link2, Trash2 } from 'lucide-react';
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
import {
  getTickerPlaceholder,
  normalizeStockMarket,
  normalizeTickerForMarket,
  STOCK_MARKETS,
} from '@/app/lib/market-rules';
import {
  EDGE_STATUSES,
  EdgeStatus,
  EdgeInput,
  GraphSnapshot,
  NODE_WEIGHT_TIERS,
  NODE_TYPES,
  NodeWeightTier,
  NodeInput,
  RELATION_TYPES,
  RelationType,
  ResearchEdge,
  ResearchNode,
  ResearchNodeType,
} from '@/app/lib/graph-types';

interface DetailPanelProps {
  snapshot: GraphSnapshot;
  view: 'industry' | 'company';
  selectedNodeId: string;
  selectedEdgeId: string;
  onSelectNode: (nodeId: string) => void;
  onUpdateNode: (nodeId: string, input: Partial<NodeInput>) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onUpdateEdge: (edgeId: string, input: Partial<EdgeInput>) => Promise<void>;
  onDeleteEdge: (edgeId: string) => Promise<void>;
}

interface NodeEditorProps {
  selectedNode: ResearchNode;
  snapshot: GraphSnapshot;
  onUpdateNode: (nodeId: string, input: Partial<NodeInput>) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
}

interface EdgeEditorProps {
  selectedEdge: ResearchEdge;
  snapshot: GraphSnapshot;
  onSelectNode: (nodeId: string) => void;
  onUpdateEdge: (edgeId: string, input: Partial<EdgeInput>) => Promise<void>;
  onDeleteEdge: (edgeId: string) => Promise<void>;
}

interface RelatedCompaniesProps {
  selectedNode: ResearchNode;
  snapshot: GraphSnapshot;
  onSelectNode: (nodeId: string) => void;
}

/**
 * 将节点转换为可编辑草稿。
 * @param selectedNode 当前节点。
 * @returns 节点输入草稿。
 */
function createNodeDraft(selectedNode: ResearchNode): NodeInput {
  const market = selectedNode.type === 'company' ? normalizeStockMarket(selectedNode.market) : '';
  return {
    type: selectedNode.type,
    weightTier: selectedNode.weightTier,
    laneId: selectedNode.laneId,
    label: selectedNode.label,
    summary: selectedNode.summary,
    ticker: selectedNode.type === 'company' ? normalizeTickerForMarket(market, selectedNode.ticker) : '',
    market,
  };
}

/**
 * 将关系转换为可编辑草稿。
 * @param selectedEdge 当前关系。
 * @returns 关系输入草稿。
 */
function createEdgeDraft(selectedEdge: ResearchEdge): EdgeInput {
  return {
    sourceId: selectedEdge.sourceId,
    targetId: selectedEdge.targetId,
    relationType: selectedEdge.relationType,
    status: selectedEdge.status,
    note: selectedEdge.note,
  };
}

/**
 * 节点编辑表单。
 * @param props 当前节点和节点 CRUD 回调。
 * @returns 节点属性编辑界面。
 */
function NodeEditor({ selectedNode, snapshot, onUpdateNode, onDeleteNode }: NodeEditorProps) {
  const [nodeDraft, setNodeDraft] = useState<NodeInput>(() => createNodeDraft(selectedNode));

  /**
   * 保存当前节点表单。
   * @param event 表单提交事件。
   */
  async function handleSaveNode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await onUpdateNode(selectedNode.id, {
      ...nodeDraft,
      laneId: nodeDraft.laneId,
      market: nodeDraft.type === 'company' ? nodeDraft.market : '',
      ticker: nodeDraft.type === 'company' ? nodeDraft.ticker : '',
    });
  }

  return (
    <section className="panelSection">
      <div className="sectionHeader">
        <h2>节点详情</h2>
        <button
          className="iconDangerButton"
          type="button"
          title="删除节点"
          onClick={() => {
            if (window.confirm(`确认删除节点「${selectedNode.label}」？相关关系也会删除。`)) {
              void onDeleteNode(selectedNode.id);
            }
          }}
        >
          <Trash2 size={16} />
        </button>
      </div>

      <form className="stackForm" onSubmit={handleSaveNode}>
        <label>
          <span>名称</span>
          <input
            value={nodeDraft.label}
            onChange={(event) => setNodeDraft({ ...nodeDraft, label: event.target.value })}
          />
        </label>
        <label>
          <span>类型</span>
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
          <span>泳道</span>
          <select
            value={nodeDraft.laneId || ''}
            onChange={(event) => setNodeDraft({ ...nodeDraft, laneId: event.target.value })}
          >
            <option value="">未配置泳道</option>
            {snapshot.lanes.map((lane) => (
              <option key={lane.id} value={lane.id}>{lane.label}</option>
            ))}
          </select>
        </label>
        {nodeDraft.type === 'company' && (
          <div className="formGrid2">
            <label>
              <span>市场</span>
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
              <span>代码</span>
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
        <label>
          <span>说明</span>
          <textarea
            value={nodeDraft.summary || ''}
            rows={4}
            onChange={(event) => setNodeDraft({ ...nodeDraft, summary: event.target.value })}
          />
        </label>
        <button className="primaryButton" type="submit">保存节点</button>
      </form>
    </section>
  );
}

/**
 * 关系编辑表单。
 * @param props 当前关系、图谱快照和关系 CRUD 回调。
 * @returns 关系属性编辑界面。
 */
function EdgeEditor({
  selectedEdge,
  snapshot,
  onSelectNode,
  onUpdateEdge,
  onDeleteEdge,
}: EdgeEditorProps) {
  const [edgeDraft, setEdgeDraft] = useState<EdgeInput>(() => createEdgeDraft(selectedEdge));
  const nodeById = useMemo(
    () => new Map(snapshot.nodes.map((node) => [node.id, node])),
    [snapshot.nodes]
  );

  /**
   * 保存当前关系表单。
   * @param event 表单提交事件。
   */
  async function handleSaveEdge(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await onUpdateEdge(selectedEdge.id, edgeDraft);
  }

  return (
    <section className="panelSection">
      <div className="sectionHeader">
        <h2>关系详情</h2>
        <button
          className="iconDangerButton"
          type="button"
          title="删除关系"
          onClick={() => {
            if (window.confirm('确认删除当前关系？')) {
              void onDeleteEdge(selectedEdge.id);
            }
          }}
        >
          <Trash2 size={16} />
        </button>
      </div>

      <form className="stackForm" onSubmit={handleSaveEdge}>
        <div className="formGrid2">
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
        </div>
        <div className="relationPreview">
          <button
            type="button"
            onClick={() => edgeDraft.sourceId && onSelectNode(edgeDraft.sourceId)}
          >
            {nodeById.get(edgeDraft.sourceId)?.label || '来源节点'}
          </button>
          <Link2 size={14} />
          <button
            type="button"
            onClick={() => edgeDraft.targetId && onSelectNode(edgeDraft.targetId)}
          >
            {nodeById.get(edgeDraft.targetId)?.label || '目标节点'}
          </button>
        </div>
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
        <label>
          <span>备注</span>
          <textarea
            value={edgeDraft.note || ''}
            rows={3}
            onChange={(event) => setEdgeDraft({ ...edgeDraft, note: event.target.value })}
          />
        </label>
        <button className="primaryButton" type="submit">保存关系</button>
      </form>
    </section>
  );
}

/**
 * 选中产业环节时展示直接关联公司。
 * @param props 当前节点、图谱快照和选择回调。
 * @returns 关联公司列表。
 */
function RelatedCompanies({
  selectedNode,
  snapshot,
  onSelectNode,
}: RelatedCompaniesProps) {
  const nodeById = useMemo(
    () => new Map(snapshot.nodes.map((node) => [node.id, node])),
    [snapshot.nodes]
  );
  const relatedRows = snapshot.edges
    .map((edge) => {
      const sourceNode = nodeById.get(edge.sourceId);
      const targetNode = nodeById.get(edge.targetId);
      if (!sourceNode || !targetNode) {
        return null;
      }
      if (edge.sourceId === selectedNode.id && targetNode.type === 'company') {
        return { edge, company: targetNode, direction: `${selectedNode.label} -> ${targetNode.label}` };
      }
      if (edge.targetId === selectedNode.id && sourceNode.type === 'company') {
        return { edge, company: sourceNode, direction: `${sourceNode.label} -> ${selectedNode.label}` };
      }
      return null;
    })
    .filter((row): row is {
      edge: ResearchEdge;
      company: ResearchNode;
      direction: string;
    } => Boolean(row))
    .sort((leftRow, rightRow) => {
      if (leftRow.edge.status === rightRow.edge.status) {
        return leftRow.company.label.localeCompare(rightRow.company.label, 'zh-CN');
      }
      const statusRank: Record<string, number> = { fact: 0, research: 1, unverified: 2 };
      return statusRank[leftRow.edge.status] - statusRank[rightRow.edge.status];
    });

  return (
    <section className="panelSection">
      <div className="sectionHeader">
        <h2>关联公司</h2>
      </div>
      {relatedRows.length === 0 ? (
        <p className="emptyState">当前环节还没有直接关联公司，可以通过新增关系把公司连接到该环节。</p>
      ) : (
        <div className="companyRelationList">
          {relatedRows.map(({ edge, company, direction }) => (
            <button
              className={`companyRelationItem status-${edge.status}`}
              key={edge.id}
              type="button"
              onClick={() => {
                onSelectNode(company.id);
              }}
            >
              <strong>{company.label}</strong>
              <span>{direction}</span>
              <small>
                {RELATION_TYPE_LABELS[edge.relationType]} · {EDGE_STATUS_LABELS[edge.status]}
              </small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * 右侧详情编辑面板。
 * @param props 图谱数据、选中对象和 CRUD 回调。
 * @returns 节点和关系编辑界面。
 */
export function DetailPanel({
  snapshot,
  view,
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onUpdateNode,
  onDeleteNode,
  onUpdateEdge,
  onDeleteEdge,
}: DetailPanelProps) {
  const selectedNode = snapshot.nodes.find((node) => node.id === selectedNodeId);
  const selectedEdge = snapshot.edges.find((edge) => edge.id === selectedEdgeId);

  return (
    <aside className="detailPanel">
      {selectedNode ? (
        <NodeEditor
          key={`node-${selectedNode.id}`}
          selectedNode={selectedNode}
          snapshot={snapshot}
          onUpdateNode={onUpdateNode}
          onDeleteNode={onDeleteNode}
        />
      ) : (
        <section className="panelSection">
          <div className="sectionHeader">
            <h2>节点详情</h2>
          </div>
          <p className="emptyState">选择一个节点后编辑名称、类型、市场和说明。</p>
        </section>
      )}

      {view === 'industry' && selectedNode && selectedNode.type !== 'company' && (
        <RelatedCompanies
          selectedNode={selectedNode}
          snapshot={snapshot}
          onSelectNode={onSelectNode}
        />
      )}

      {selectedEdge ? (
        <EdgeEditor
          key={`edge-${selectedEdge.id}`}
          selectedEdge={selectedEdge}
          snapshot={snapshot}
          onSelectNode={onSelectNode}
          onUpdateEdge={onUpdateEdge}
          onDeleteEdge={onDeleteEdge}
        />
      ) : (
        <section className="panelSection">
          <div className="sectionHeader">
            <h2>关系详情</h2>
          </div>
          <p className="emptyState">选择一条线后编辑关系类型、关系状态和备注。</p>
        </section>
      )}
    </aside>
  );
}
