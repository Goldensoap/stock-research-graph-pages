import { NextRequest, NextResponse } from 'next/server';
import { deleteLane, updateLane } from '@/app/lib/graph-db';

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

/**
 * 更新产业链泳道。
 * @param request HTTP 请求，主体为泳道更新字段。
 * @param context 动态路由参数。
 * @returns 更新后的泳道。
 */
export async function PATCH(request: NextRequest, context: RouteParams) {
  try {
    const { id } = await context.params;
    const payload = await request.json();
    const lane = updateLane(id, payload);
    return NextResponse.json(lane);
  } catch (error) {
    console.error('[API Lanes] 更新泳道失败:', error);
    return NextResponse.json(
      { error: '更新泳道失败', message: error instanceof Error ? error.message : '未知错误' },
      { status: 400 }
    );
  }
}

/**
 * 删除产业链泳道。
 * @param _request HTTP 请求。
 * @param context 动态路由参数。
 * @returns 删除结果。
 */
export async function DELETE(_request: NextRequest, context: RouteParams) {
  try {
    const { id } = await context.params;
    const deleted = deleteLane(id);
    if (!deleted) {
      return NextResponse.json({ error: '泳道不存在' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API Lanes] 删除泳道失败:', error);
    return NextResponse.json(
      { error: '删除泳道失败', message: error instanceof Error ? error.message : '未知错误' },
      { status: 400 }
    );
  }
}
