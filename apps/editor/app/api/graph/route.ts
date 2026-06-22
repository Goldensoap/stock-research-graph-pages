import { NextRequest, NextResponse } from 'next/server';
import { getGraphSnapshot } from '@/app/lib/graph-db';

/**
 * 返回完整产研图谱快照。
 * @param request HTTP 请求，可通过 graphId 指定产业图谱。
 * @returns JSON 格式的节点和关系数据。
 */
export async function GET(request: NextRequest) {
  try {
    const graphId = request.nextUrl.searchParams.get('graphId') || undefined;
    return NextResponse.json(getGraphSnapshot(graphId));
  } catch (error) {
    console.error('[API Graph] 获取图谱失败:', error);
    return NextResponse.json(
      { error: '获取图谱失败', message: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    );
  }
}
