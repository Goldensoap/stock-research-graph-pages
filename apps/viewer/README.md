# 产研图谱 GitHub Pages 静态站

这是产研图谱仓库中的静态前端应用，用于把图谱部署为 GitHub Pages project site。站点不包含数据库和后端 API，只在浏览器中读取 `public/data/graphs` 下的 JSON 文件并渲染只读图谱。

## 本地运行

```bash
cd apps/viewer
npm install
npm run dev
```

## 本地构建

```bash
cd apps/viewer
npm run build
```

构建产物位于 `dist/`，GitHub Actions 会自动把它发布到 GitHub Pages。

## 更新图谱

1. 把从编辑版产研图谱导出的 `stock-research-graph.authoring` JSON 放到 `public/data/graphs/`。
2. 在 `public/data/graphs/index.json` 中追加图谱入口：

```json
{
  "id": "semiconductor",
  "label": "半导体产业链",
  "file": "semiconductor.json",
  "summary": "半导体产业链只读图谱。"
}
```

3. 提交并推送到 GitHub，等待 Actions 完成部署。

## GitHub Pages 设置

在 GitHub 仓库页面进入 `Settings -> Pages`，把 `Build and deployment -> Source` 设置为 `GitHub Actions`。推送到 `main` 分支后，根目录 `.github/workflows/pages.yml` 会构建并发布 `apps/viewer`。

项目站点地址通常是：

```text
https://<你的 GitHub 用户名>.github.io/<仓库名>/
```

## 数据公开性

GitHub Pages 是公开静态站点。不要把未公开研报、账号、密钥、数据库文件或任何敏感信息放入本仓库。
