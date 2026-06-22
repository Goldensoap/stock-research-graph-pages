import { NextRequest, NextResponse } from 'next/server';
import { createLane } from '@/app/lib/graph-db';

/**
 * 创建产业链泳道。
 * @param request HTTP 请求，主体为泳道输入信息。
 * @returns 创建后的泳道。
 */
export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const lane = createLane(payload);
    return NextResponse.json(lane, { status: 201 });
  } catch (error) {
    console.error('[API Lanes] 创建泳道失败:', error);
    return NextResponse.json(
      { error: '创建泳道失败', message: error instanceof Error ? error.message : '未知错误' },
      { status: 400 }
    );
  }
}
