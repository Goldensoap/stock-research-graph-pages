import { NextRequest, NextResponse } from 'next/server';
import { createEdge } from '@/app/lib/graph-db';

/**
 * 创建图谱关系。
 * @param request HTTP 请求，主体为关系输入信息。
 * @returns 创建后的关系。
 */
export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const edge = createEdge(payload);
    return NextResponse.json(edge, { status: 201 });
  } catch (error) {
    console.error('[API Edges] 创建关系失败:', error);
    return NextResponse.json(
      { error: '创建关系失败', message: error instanceof Error ? error.message : '未知错误' },
      { status: 400 }
    );
  }
}
