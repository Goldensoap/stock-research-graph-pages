# 产研图谱

本仓库把本地可编辑工具和 GitHub Pages 静态只读站放在一起维护。编辑器用于本地维护图谱数据，静态站用于公开展示导出的 JSON 图谱。

## 目录结构

```text
apps/
  editor/      # 本地可编辑 Next.js 工具，使用 SQLite，不部署到 GitHub Pages
  viewer/      # GitHub Pages 静态只读站，读取静态 JSON 渲染图谱
docs/          # 图谱 JSON 格式和维护文档
```

## 本地编辑器

```bash
cd apps/editor
npm install
npm run dev
```

编辑器默认使用本地 SQLite。数据库文件和 `.env` 不提交到 Git。

## 静态展示站

```bash
cd apps/viewer
npm install
npm run dev
```

静态站的数据位于：

```text
apps/viewer/public/data/graphs/
```

## 更新公开图谱

1. 在 `apps/editor` 中编辑图谱。
2. 导出 `stock-research-graph.authoring` 格式 JSON。
3. 放入 `apps/viewer/public/data/graphs/`。
4. 更新 `apps/viewer/public/data/graphs/index.json`。
5. 在 `apps/viewer` 下运行 `npm run build` 验证。
6. 提交并推送到 `main`，GitHub Actions 会自动发布静态站。

## GitHub Pages

`.github/workflows/pages.yml` 只构建并发布 `apps/viewer`，不会部署 `apps/editor`。

## 数据公开性

GitHub Pages 是公开静态站点。不要提交 SQLite 数据库、账号密钥、未公开研报或任何敏感信息。
