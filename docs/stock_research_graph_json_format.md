# 股市产研图谱可编辑 JSON 书写规则

本文档用于指导外部系统或人工编写产业图谱 JSON。默认导入导出格式是“可编辑格式”，不要求外部填写数据库 ID 和时间字段。

## 设计原则

- 图谱使用 `graph.label` 作为唯一名称；同名图谱导入时更新该图谱，不会新建重复图谱。
- 外部不填写 `id`、`createdAt`、`updatedAt`、`memberships`。
- 节点按业务唯一键锁定：
  - 公司节点优先使用 `type + market + ticker` 唯一。
  - 没有证券代码的公司节点使用 `type + label` 唯一。
  - 非公司节点使用 `type + label` 唯一。
- 关系使用可读引用：`from` 和 `to` 可以写节点名称，也可以写带类型的引用。

## 顶层结构

```json
{
  "schemaVersion": 2,
  "kind": "stock-research-graph.authoring",
  "graph": {},
  "lanes": [],
  "nodes": [],
  "edges": []
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `schemaVersion` | number | 是 | 当前必须为 `2` |
| `kind` | string | 是 | 当前必须为 `stock-research-graph.authoring` |
| `graph` | object | 是 | 单个产业图谱信息 |
| `lanes` | array | 是 | 当前图谱的泳道 |
| `nodes` | array | 是 | 当前图谱的节点 |
| `edges` | array | 是 | 当前图谱的关系 |

## graph

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `label` | string | 是 | 图谱名称，全局唯一 |
| `summary` | string | 否 | 图谱说明 |
| `sortOrder` | number | 否 | 图谱排序；省略时保留已有排序或使用默认值 |

## lanes

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `label` | string | 是 | 泳道名称，同一图谱内唯一 |
| `color` | string | 否 | 颜色值，例如 `#2563eb`；省略时使用默认蓝色 |
| `order` | number | 否 | 泳道排序；省略时按数组顺序生成 |

## nodes

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | string | 是 | 节点类型，见“枚举值” |
| `label` | string | 是 | 节点名称 |
| `weightTier` | string | 否 | 节点权重，省略时为 `medium` |
| `lane` | string | 否 | 泳道名称；非空时必须存在于 `lanes[].label` |
| `order` | number | 否 | 节点在图谱内的排序；省略时按数组顺序生成 |
| `summary` | string | 否 | 节点说明 |
| `market` | string | 否 | 公司节点上市市场 |
| `ticker` | string | 否 | 公司节点证券代码 |

非公司节点不能填写 `market` 或 `ticker`。公司节点的 `market` 和 `ticker` 必须同时填写或同时省略。

支持市场：

| 市场 | 证券代码规则 |
| --- | --- |
| `A股` | 6 位数字，例如 `600519` |
| `美股` | 大写字母，可包含 `.` 或 `-`，长度 1-10 位，例如 `NVDA` |
| `韩股` | 6 位数字，例如 `005930` |
| `日股` | 4 位数字，例如 `7203` |
| `欧洲股市` | 大写字母或数字，可包含 `.` 或 `-`，长度 1-12 位，例如 `ASML` |

## edges

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `from` | string | 是 | 来源节点引用 |
| `to` | string | 是 | 目标节点引用 |
| `relationType` | string | 是 | 关系类型，见“枚举值” |
| `status` | string | 否 | 关系状态，省略时为 `unverified` |
| `weight` | number | 否 | 关系权重，省略时为 `1` |
| `note` | string | 否 | 关系备注 |

节点引用支持三种写法：

| 写法 | 示例 | 使用场景 |
| --- | --- | --- |
| 节点名称 | `NVIDIA` | 当前文件中名称不重复时 |
| 类型加名称 | `company:NVIDIA` | 名称可能与概念或产业重名时 |
| 公司完整引用 | `company:NVIDIA:美股:NVDA` | 公司重名或需要精确引用证券主体时 |

同一图谱内，`from + to + relationType` 组合不能重复。

## 枚举值

节点类型 `type`：

```json
["narrative", "industry", "concept", "product", "material", "process", "company"]
```

节点权重 `weightTier`：

```json
["high", "medium", "low"]
```

关系类型 `relationType`：

```json
["contains", "upstream", "downstream", "produces", "supplies", "benefits", "substitute", "competition", "exposure"]
```

关系状态 `status`：

```json
["fact", "research", "unverified"]
```

## 导入行为

导入时系统先校验完整 JSON，全部通过后才在事务中写入。

- 按 `graph.label` 查找目标图谱。
- 同名图谱存在时，替换该图谱的泳道、节点归属和关系。
- 同名图谱不存在时，创建新图谱。
- 其他图谱不会被删除。
- 节点按业务唯一键复用或更新。
- 导入失败不会写入任何部分数据。

## 示例

```json
{
  "schemaVersion": 2,
  "kind": "stock-research-graph.authoring",
  "graph": {
    "label": "AI服务器",
    "summary": "围绕训练和推理服务器展开的产业图谱。",
    "sortOrder": 10
  },
  "lanes": [
    { "label": "算力芯片", "color": "#2563eb", "order": 10 },
    { "label": "PCB 与材料", "color": "#0f766e", "order": 20 }
  ],
  "nodes": [
    {
      "type": "narrative",
      "label": "AI服务器",
      "weightTier": "high",
      "summary": "AI 训练和推理服务器产业叙事。"
    },
    {
      "type": "concept",
      "label": "GPU",
      "weightTier": "high",
      "lane": "算力芯片",
      "summary": "AI 训练和推理核心加速芯片。"
    },
    {
      "type": "company",
      "label": "NVIDIA",
      "weightTier": "high",
      "market": "美股",
      "ticker": "NVDA",
      "summary": "AI GPU 龙头公司。"
    }
  ],
  "edges": [
    {
      "from": "AI服务器",
      "to": "GPU",
      "relationType": "contains",
      "status": "fact",
      "note": "AI 服务器核心算力环节。"
    },
    {
      "from": "company:NVIDIA:美股:NVDA",
      "to": "GPU",
      "relationType": "produces",
      "status": "fact",
      "note": "NVIDIA 与 GPU 环节相关。"
    }
  ]
}
```

## 内部备份格式

系统仍支持 `kind = stock-research-graph.graph`、`schemaVersion = 1` 的完整备份格式。该格式包含 `id`、时间字段和 `memberships`，适合精确备份和恢复，不建议外部人工编写。

如需获取内部备份格式，可调用：

```text
GET /api/graph/export?graphId=<graphId>&format=backup
```
