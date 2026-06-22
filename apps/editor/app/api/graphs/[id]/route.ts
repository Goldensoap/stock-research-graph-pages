import { NextRequest, NextResponse } from 'next/server';
import { deleteGraph } from '@/app/lib/graph-db';

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

/**
 * 删除产业图谱。
 * @param _request HTTP 请求。
 * @param context 动态路由参数。
 * @returns 删除结果。
 */
export async function DELETE(_request: NextRequest, context: RouteParams) {
  try {
    const { id } = await context.params;
    const deleted = deleteGraph(id);
    if (!deleted) {
      return NextResponse.json({ error: '图谱不存在' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API Graphs] 删除产业图谱失败:', error);
    return NextResponse.json(
      { error: '删除产业图谱失败', message: error instanceof Error ? error.message : '未知错误' },
      { status: 400 }
    );
  }
}
