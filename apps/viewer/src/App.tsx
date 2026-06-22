import { useEffect, useMemo, useState } from 'react';
import { Building2, GitBranch, Layers, Network, RefreshCw, Search } from 'lucide-react';
import { GraphCanvas, GraphViewMode } from './components/GraphCanvas';
import {
  EDGE_STATUS_LABELS,
  NODE_TYPE_LABELS,
  RELATION_TYPE_LABELS,
} from './lib/graph-labels';
import {
  GraphSnapshot,
  RELATION_TYPES,
  RelationType,
  ResearchEdge,
  ResearchNode,
} from './lib/graph-types';
import {
  loadGraphIndex,
  loadGraphSnapshot,
  StaticGraphIndexItem,
} from './lib/static-graph-loader';

const EMPTY_SNAPSHOT: GraphSnapshot = {
  graphs: [],
  currentGraphId: '',
  lanes: [],
  nodes: [],
  edges: [],
};

/**
 * 查找当前选中的节点。
 * @param snapshot 当前图谱快照。
 * @param selectedNodeId 当前节点 ID。
 * @returns 当前节点或空值。
 */
function findSelectedNode(snapshot: GraphSnapshot, selectedNodeId: string): ResearchNode | undefined {
  return snapshot.nodes.find((node) => node.id === selectedNodeId);
}

/**
 * 查找当前选中的关系。
 * @param snapshot 当前图谱快照。
 * @param selectedEdgeId 当前关系 ID。
 * @returns 当前关系或空值。
 */
function findSelectedEdge(snapshot: GraphSnapshot, selectedEdgeId: string): ResearchEdge | undefined {
  return snapshot.edges.find((edge) => edge.id === selectedEdgeId);
}

/**
 * 获取节点展示副标题。
 * @param node 图谱节点。
 * @returns 节点副标题。
 */
function formatNodeSubtitle(node: ResearchNode): string {
  if (node.type === 'company' && node.market && node.ticker) {
    return `${node.market} · ${node.ticker}`;
  }
  return NODE_TYPE_LABELS[node.type];
}

/**
 * 只读图谱站点。
 * @returns GitHub Pages 使用的静态图谱浏览页面。
 */
export default function App() {
  const [graphIndex, setGraphIndex] = useState<StaticGraphIndexItem[]>([]);
  const [currentGraphId, setCurrentGraphId] = useState('');
  const [snapshot, setSnapshot] = useState<GraphSnapshot>(EMPTY_SNAPSHOT);
  const [viewMode, setViewMode] = useState<GraphViewMode>('industry');
  const [searchText, setSearchText] = useState('');
  const [relationFilter, setRelationFilter] = useState<RelationType | 'all'>('all');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [selectedEdgeId, setSelectedEdgeId] = useState('');
  const [statusMessage, setStatusMessage] = useState('正在读取图谱索引...');

  const currentGraphItem = useMemo(
    () => graphIndex.find((graph) => graph.id === currentGraphId),
    [currentGraphId, graphIndex]
  );
  const selectedNode = useMemo(
    () => findSelectedNode(snapshot, selectedNodeId),
    [selectedNodeId, snapshot]
  );
  const selectedEdge = useMemo(
    () => findSelectedEdge(snapshot, selectedEdgeId),
    [selectedEdgeId, snapshot]
  );
  const nodeById = useMemo(
    () => new Map(snapshot.nodes.map((node) => [node.id, node])),
    [snapshot.nodes]
  );

  useEffect(() => {
    let isActive = true;

    async function loadIndex(): Promise<void> {
      try {
        const index = await loadGraphIndex();
        if (!isActive) {
          return;
        }
        setGraphIndex(index.graphs);
        setCurrentGraphId(index.graphs[0]?.id || '');
        setStatusMessage(index.graphs.length > 0 ? '图谱索引已加载' : '图谱索引为空');
      } catch (error) {
        if (!isActive) {
          return;
        }
        setStatusMessage(error instanceof Error ? error.message : '图谱索引读取失败');
      }
    }

    void loadIndex();
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!currentGraphItem) {
      return;
    }
    const graphItem = currentGraphItem;
    let isActive = true;

    async function loadCurrentGraph(): Promise<void> {
      try {
        setStatusMessage(`正在读取「${graphItem.label}」...`);
        const nextSnapshot = await loadGraphSnapshot(graphItem);
        if (!isActive) {
          return;
        }
        setSnapshot(nextSnapshot);
        setSelectedNodeId('');
        setSelectedEdgeId('');
        setStatusMessage(`已加载「${graphItem.label}」`);
      } catch (error) {
        if (!isActive) {
          return;
        }
        setSnapshot(EMPTY_SNAPSHOT);
        setStatusMessage(error instanceof Error ? error.message : '图谱读取失败');
      }
    }

    void loadCurrentGraph();
    return () => {
      isActive = false;
    };
  }, [currentGraphItem]);

  return (
    <main className="staticGraphPage">
      <aside className="viewerSidebar">
        <section className="viewerBrand">
          <div className="viewerBrandIcon">
            <Network size={22} aria-hidden="true" />
          </div>
          <div>
            <h1>产研图谱</h1>
            <p>静态只读版</p>
          </div>
        </section>

        <section className="viewerControls" aria-label="图谱筛选">
          <label className="viewerField">
            <span>当前图谱</span>
            <select
              value={currentGraphId}
              onChange={(event) => setCurrentGraphId(event.target.value)}
            >
              {graphIndex.map((graph) => (
                <option key={graph.id} value={graph.id}>{graph.label}</option>
              ))}
            </select>
          </label>

          <label className="viewerSearch">
            <Search size={16} aria-hidden="true" />
            <input
              value={searchText}
              placeholder="搜索节点、代码、说明"
              onChange={(event) => setSearchText(event.target.value)}
            />
          </label>

          <div className="viewerSegmented" aria-label="图谱视图">
            <button
              className={viewMode === 'industry' ? 'active' : ''}
              type="button"
              title="产业链视图"
              onClick={() => setViewMode('industry')}
            >
              <Layers size={16} aria-hidden="true" />
              <span>产业</span>
            </button>
            <button
              className={viewMode === 'company' ? 'active' : ''}
              type="button"
              title="公司关系视图"
              onClick={() => setViewMode('company')}
            >
              <Building2 size={16} aria-hidden="true" />
              <span>公司</span>
            </button>
          </div>

          <label className="viewerField">
            <span>关系类型</span>
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

        <section className="viewerMeta" aria-label="图谱信息">
          <div>
            <span>{snapshot.nodes.length}</span>
            <small>节点</small>
          </div>
          <div>
            <span>{snapshot.edges.length}</span>
            <small>关系</small>
          </div>
          <div>
            <span>{snapshot.lanes.length}</span>
            <small>泳道</small>
          </div>
        </section>

        <section className="viewerDetail" aria-label="选中对象详情">
          {selectedNode ? (
            <>
              <header>
                <strong>{selectedNode.label}</strong>
                <span>{formatNodeSubtitle(selectedNode)}</span>
              </header>
              {selectedNode.summary ? <p>{selectedNode.summary}</p> : null}
            </>
          ) : selectedEdge ? (
            <>
              <header>
                <strong>{RELATION_TYPE_LABELS[selectedEdge.relationType]}</strong>
                <span>{EDGE_STATUS_LABELS[selectedEdge.status]}</span>
              </header>
              <p>
                {nodeById.get(selectedEdge.sourceId)?.label || selectedEdge.sourceId}
                {' → '}
                {nodeById.get(selectedEdge.targetId)?.label || selectedEdge.targetId}
              </p>
              {selectedEdge.note ? <p>{selectedEdge.note}</p> : null}
            </>
          ) : (
            <p>选择图谱中的节点或关系后显示详情。</p>
          )}
        </section>
      </aside>

      <section className="viewerMain" aria-label="图谱画布">
        <header className="viewerTopbar">
          <div>
            <strong>{currentGraphItem?.label || '未选择图谱'}</strong>
            <span>{currentGraphItem?.summary || snapshot.graphs[0]?.summary || statusMessage}</span>
          </div>
          <button
            type="button"
            title="重新加载静态 JSON"
            onClick={() => {
              if (currentGraphItem) {
                void loadGraphSnapshot(currentGraphItem).then((nextSnapshot) => {
                  setSnapshot(nextSnapshot);
                  setStatusMessage(`已重新加载「${currentGraphItem.label}」`);
                });
              }
            }}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </header>

        <GraphCanvas
          snapshot={snapshot}
          viewMode={viewMode}
          selectedNodeId={selectedNodeId}
          selectedEdgeId={selectedEdgeId}
          searchText={searchText}
          relationFilter={relationFilter}
          onSelectNode={(nodeId) => {
            setSelectedNodeId(nodeId);
            setSelectedEdgeId('');
          }}
          onSelectEdge={(edgeId) => {
            setSelectedEdgeId(edgeId);
            setSelectedNodeId('');
          }}
        />

        <footer className="viewerStatus">
          <GitBranch size={14} aria-hidden="true" />
          <span>{statusMessage}</span>
        </footer>
      </section>
    </main>
  );
}
