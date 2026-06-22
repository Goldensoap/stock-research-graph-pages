import { NextRequest, NextResponse } from 'next/server';
import { exportGraphAuthoringDocument, exportGraphDocument } from '@/app/lib/graph-db';

/**
 * 生成安全的导出文件名。
 * @param graphLabel 产业图谱名称。
 * @param suffix 文件后缀。
 * @returns Content-Disposition 头。
 */
function createContentDisposition(graphLabel: string, suffix: string): string {
  const fallbackName = `research-graph-${suffix}.json`;
  const encodedName = encodeURIComponent(`${graphLabel || 'research-graph'}-${suffix}.json`);
  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`;
}

/**
 * 导出单个产业图谱 JSON 文档。
 * @param request HTTP 请求，可通过 graphId 指定产业图谱。
 * @returns 完整单图谱 JSON 文档。
 */
export async function GET(request: NextRequest) {
  try {
    const graphId = request.nextUrl.searchParams.get('graphId') || undefined;
    const format = request.nextUrl.searchParams.get('format') || 'authoring';
    const document = format === 'backup'
      ? exportGraphDocument(graphId)
      : exportGraphAuthoringDocument(graphId);
    const graphLabel = document.graph.label;
    const suffix = format === 'backup' ? 'backup' : 'editable';
    return NextResponse.json(document, {
      headers: {
        'Content-Disposition': createContentDisposition(graphLabel, suffix),
      },
    });
  } catch (error) {
    console.error('[API Graph Export] 导出图谱失败:', error);
    return NextResponse.json(
      { error: '导出图谱失败', message: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    );
  }
}
