import { EdgeStatus, NodeWeightTier, RelationType, ResearchNodeType } from './graph-types';

export const NODE_TYPE_LABELS: Record<ResearchNodeType, string> = {
  narrative: '叙事',
  industry: '产业',
  concept: '概念',
  product: '产品',
  material: '材料',
  process: '工艺',
  company: '公司',
};

export const NODE_TYPE_DESCRIPTIONS: Record<ResearchNodeType, string> = {
  narrative: '顶层研究主题或大产业叙事',
  industry: '产业或子产业层级，用于归纳一组环节',
  concept: '研究概念、产业环节或投资主题',
  product: '具体产品、部件或设备',
  material: '上游材料、耗材或关键原料',
  process: '制造工艺、技术路线或加工方法',
  company: '公司主体，可配置市场代码并参与公司关系',
};

const CONCEPT_WEIGHT_TIER_LABELS: Record<NodeWeightTier, string> = {
  high: '核心',
  medium: '重要',
  low: '一般',
};

const COMPANY_WEIGHT_TIER_LABELS: Record<NodeWeightTier, string> = {
  high: 'T1',
  medium: 'T2',
  low: 'T3',
};

const CONCEPT_WEIGHT_TIER_DESCRIPTIONS: Record<NodeWeightTier, string> = {
  high: '核心环节或核心变量，图中显示为最大圆点',
  medium: '重要环节或重要变量，图中显示为中等圆点',
  low: '一般环节或补充变量，图中显示为较小圆点',
};

const COMPANY_WEIGHT_TIER_DESCRIPTIONS: Record<NodeWeightTier, string> = {
  high: '一线公司或核心标的，图中显示为最大圆点',
  medium: '二线公司或重要标的，图中显示为中等圆点',
  low: '三线公司或观察标的，图中显示为较小圆点',
};

/**
 * 获取节点权重档位展示名称。
 * @param nodeType 节点类型。
 * @param weightTier 节点权重档位。
 * @returns 面向当前节点类型的权重名称。
 */
export function getNodeWeightTierLabel(nodeType: ResearchNodeType, weightTier: NodeWeightTier): string {
  return nodeType === 'company'
    ? COMPANY_WEIGHT_TIER_LABELS[weightTier]
    : CONCEPT_WEIGHT_TIER_LABELS[weightTier];
}

/**
 * 获取节点权重档位说明。
 * @param nodeType 节点类型。
 * @param weightTier 节点权重档位。
 * @returns 面向当前节点类型的权重说明。
 */
export function getNodeWeightTierDescription(nodeType: ResearchNodeType, weightTier: NodeWeightTier): string {
  return nodeType === 'company'
    ? COMPANY_WEIGHT_TIER_DESCRIPTIONS[weightTier]
    : CONCEPT_WEIGHT_TIER_DESCRIPTIONS[weightTier];
}

export const RELATION_TYPE_LABELS: Record<RelationType, string> = {
  contains: '包含',
  upstream: '上游',
  downstream: '下游',
  produces: '生产',
  supplies: '供应',
  benefits: '受益',
  substitute: '替代',
  competition: '竞争',
  exposure: '暴露',
};

export const RELATION_TYPE_DESCRIPTIONS: Record<RelationType, string> = {
  contains: '来源包含目标，用于主题到环节、环节到子环节',
  upstream: '目标是来源的上游投入或前置环节',
  downstream: '目标是来源的下游应用或承接环节',
  produces: '来源生产、制造或提供目标',
  supplies: '来源向目标供货或提供服务',
  benefits: '来源受益于目标的需求、价格或景气变化',
  substitute: '来源与目标存在替代关系',
  competition: '来源与目标存在竞争关系',
  exposure: '来源对目标环节有业务暴露或收入关联',
};

export const EDGE_STATUS_LABELS: Record<EdgeStatus, string> = {
  fact: '事实',
  research: '研究判断',
  unverified: '未验证',
};

export const EDGE_STATUS_DESCRIPTIONS: Record<EdgeStatus, string> = {
  fact: '已有公告、财报、官网或正式材料确认',
  research: '基于产业逻辑、公开线索或调研形成的判断',
  unverified: '暂存线索，尚未完成核验',
};

/**
 * 生成带含义说明的选项文本。
 * @param label 选项名称。
 * @param description 选项含义。
 * @returns 可直接展示在下拉框中的文本。
 */
export function formatDescribedOption(label: string, description: string): string {
  return `${label} - ${description}`;
}
