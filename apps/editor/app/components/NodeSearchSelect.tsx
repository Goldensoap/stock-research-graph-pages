'use client';

import { useMemo, useState } from 'react';
import { NODE_TYPE_LABELS } from '@/app/lib/graph-labels';
import { ResearchNode } from '@/app/lib/graph-types';

interface NodeSearchSelectProps {
  label: string;
  nodes: ResearchNode[];
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
  excludeNodeId?: string;
  placeholder?: string;
}

/**
 * 格式化节点搜索选项。
 * @param node 图谱节点。
 * @returns 展示文本。
 */
function formatNodeOption(node: ResearchNode): string {
  const listing = [node.market, node.ticker].filter(Boolean).join(' ');
  const detail = [NODE_TYPE_LABELS[node.type], listing].filter(Boolean).join(' · ');
  return detail ? `${node.label} · ${detail}` : node.label;
}

/**
 * 判断节点是否命中搜索。
 * @param node 图谱节点。
 * @param query 搜索关键词。
 * @returns 是否命中。
 */
function matchesNodeQuery(node: ResearchNode, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  return [
    node.label,
    NODE_TYPE_LABELS[node.type],
    node.market,
    node.ticker,
    node.summary,
  ].some((value) => value.toLowerCase().includes(normalizedQuery));
}

/**
 * 节点搜索选择器。
 * @param props 节点列表、当前选中节点和选择回调。
 * @returns 可搜索节点选择控件。
 */
export function NodeSearchSelect({
  label,
  nodes,
  selectedNodeId,
  onSelectNode,
  excludeNodeId,
  placeholder = '搜索节点名称、类型、代码',
}: NodeSearchSelectProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId),
    [nodes, selectedNodeId]
  );
  const selectedLabel = selectedNode ? formatNodeOption(selectedNode) : '';
  const filteredNodes = useMemo(() => (
    nodes
      .filter((node) => node.id !== excludeNodeId)
      .filter((node) => matchesNodeQuery(node, query))
      .slice(0, 12)
  ), [excludeNodeId, nodes, query]);

  return (
    <div className="nodeSearchSelect">
      <span className="fieldLabel">{label}</span>
      <input
        value={isOpen ? query : selectedLabel}
        placeholder={placeholder}
        onFocus={() => {
          setQuery('');
          setIsOpen(true);
        }}
        onBlur={() => {
          window.setTimeout(() => setIsOpen(false), 140);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
        }}
      />
      {isOpen && (
        <div className="nodeSearchResults">
          {filteredNodes.length ? filteredNodes.map((node) => (
            <button
              key={node.id}
              className={node.id === selectedNodeId ? 'active' : ''}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                onSelectNode(node.id);
                setQuery(formatNodeOption(node));
                setIsOpen(false);
              }}
            >
              <strong>{node.label}</strong>
              <span>{[NODE_TYPE_LABELS[node.type], node.market, node.ticker].filter(Boolean).join(' · ')}</span>
            </button>
          )) : (
            <p>没有匹配节点</p>
          )}
        </div>
      )}
    </div>
  );
}
