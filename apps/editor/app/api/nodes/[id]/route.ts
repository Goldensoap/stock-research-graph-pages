import { NextRequest, NextResponse } from 'next/server';
import { deleteNode, updateNode } from '@/app/lib/graph-db';

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

/**
 * 更新图谱节点。
 * @param request HTTP 请求，主体为节点更新字段。
 * @param context 动态路由参数。
 * @returns 更新后的节点。
 */
export async function PATCH(request: NextRequest, context: RouteParams) {
  try {
    const { id } = await context.params;
    const payload = await request.json();
    const node = updateNode(id, payload);
    return NextResponse.json(node);
  } catch (error) {
    console.error('[API Nodes] 更新节点失败:', error);
    return NextResponse.json(
      { error: '更新节点失败', message: error instanceof Error ? error.message : '未知错误' },
      { status: 400 }
    );
  }
}

/**
 * 删除图谱节点。
 * @param _request HTTP 请求。
 * @param context 动态路由参数。
 * @returns 删除结果。
 */
export async function DELETE(_request: NextRequest, context: RouteParams) {
  try {
    const { id } = await context.params;
    const deleted = deleteNode(id);
    if (!deleted) {
      return NextResponse.json({ error: '节点不存在' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API Nodes] 删除节点失败:', error);
    return NextResponse.json(
      { error: '删除节点失败', message: error instanceof Error ? error.message : '未知错误' },
      { status: 400 }
    );
  }
}
