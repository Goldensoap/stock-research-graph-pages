import { NextRequest, NextResponse } from 'next/server';
import { deleteEdge, updateEdge } from '@/app/lib/graph-db';

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

/**
 * 更新图谱关系。
 * @param request HTTP 请求，主体为关系更新字段。
 * @param context 动态路由参数。
 * @returns 更新后的关系。
 */
export async function PATCH(request: NextRequest, context: RouteParams) {
  try {
    const { id } = await context.params;
    const payload = await request.json();
    const edge = updateEdge(id, payload);
    return NextResponse.json(edge);
  } catch (error) {
    console.error('[API Edges] 更新关系失败:', error);
    return NextResponse.json(
      { error: '更新关系失败', message: error instanceof Error ? error.message : '未知错误' },
      { status: 400 }
    );
  }
}

/**
 * 删除图谱关系。
 * @param _request HTTP 请求。
 * @param context 动态路由参数。
 * @returns 删除结果。
 */
export async function DELETE(_request: NextRequest, context: RouteParams) {
  try {
    const { id } = await context.params;
    const deleted = deleteEdge(id);
    if (!deleted) {
      return NextResponse.json({ error: '关系不存在' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API Edges] 删除关系失败:', error);
    return NextResponse.json(
      { error: '删除关系失败', message: error instanceof Error ? error.message : '未知错误' },
      { status: 400 }
    );
  }
}
