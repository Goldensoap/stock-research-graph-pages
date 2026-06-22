import { NextRequest, NextResponse } from 'next/server';
import { createGraph } from '@/app/lib/graph-db';

/**
 * 创建产业图谱。
 * @param request HTTP 请求，主体为图谱输入信息。
 * @returns 创建后的产业图谱。
 */
export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const graph = createGraph(payload);
    return NextResponse.json(graph, { status: 201 });
  } catch (error) {
    console.error('[API Graphs] 创建产业图谱失败:', error);
    return NextResponse.json(
      { error: '创建产业图谱失败', message: error instanceof Error ? error.message : '未知错误' },
      { status: 400 }
    );
  }
}
