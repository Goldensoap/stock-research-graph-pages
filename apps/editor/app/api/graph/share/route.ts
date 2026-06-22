import { NextRequest, NextResponse } from 'next/server';
import { exportGraphAuthoringDocument } from '@/app/lib/graph-db';
import { generateShareGraphHtml } from '@/app/lib/graph-share-html';

/**
 * 生成安全的分享页导出文件名。
 * @param graphLabel 产业图谱名称。
 * @returns Content-Disposition 头。
 */
function createContentDisposition(graphLabel: string): string {
  const fallbackName = 'research-graph-share.html';
  const encodedName = encodeURIComponent(`${graphLabel || 'research-graph'}-share.html`);
  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`;
}

/**
 * 导出单个产业图谱的静态分享 HTML。
 * @param request HTTP 请求，可通过 graphId 指定产业图谱。
 * @returns 完整自包含的 HTML 文件。
 */
export async function GET(request: NextRequest) {
  try {
    const graphId = request.nextUrl.searchParams.get('graphId') || undefined;
    const document = exportGraphAuthoringDocument(graphId);
    const html = generateShareGraphHtml(document);

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': createContentDisposition(document.graph.label),
      },
    });
  } catch (error) {
    console.error('[API Graph Share] 导出分享 HTML 失败:', error);
    return NextResponse.json(
      { error: '导出分享 HTML 失败', message: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    );
  }
}
