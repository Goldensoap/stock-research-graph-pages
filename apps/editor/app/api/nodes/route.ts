import { NextRequest, NextResponse } from 'next/server';
import { createNode } from '@/app/lib/graph-db';

/**
 * 创建图谱节点。
 * @param request HTTP 请求，主体为节点输入信息。
 * @returns 创建后的节点。
 */
export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const node = createNode(payload);
    return NextResponse.json(node, { status: 201 });
  } catch (error) {
    console.error('[API Nodes] 创建节点失败:', error);
    return NextResponse.json(
      { error: '创建节点失败', message: error instanceof Error ? error.message : '未知错误' },
      { status: 400 }
    );
  }
}
