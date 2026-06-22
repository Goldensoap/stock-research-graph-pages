import { NextRequest, NextResponse } from 'next/server';
import { GraphImportValidationError, importGraphDocument } from '@/app/lib/graph-db';
import { GraphImportValidationIssue } from '@/app/lib/graph-types';

/**
 * 创建 JSON 语法错误响应。
 * @param message 语法错误说明。
 * @returns Next.js JSON 响应。
 */
function createSyntaxErrorResponse(message: string): NextResponse {
  const issues: GraphImportValidationIssue[] = [{ path: '$', message }];
  return NextResponse.json(
    { error: '导入 JSON 语法错误', message, errors: issues },
    { status: 400 }
  );
}

/**
 * 导入单个产业图谱 JSON 文档。
 * @param request HTTP 请求，主体为完整 JSON 文本。
 * @returns 导入结果摘要。
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  let payload: unknown;

  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'JSON 解析失败';
    console.warn('[API Graph Import] JSON 语法错误:', message);
    return createSyntaxErrorResponse(message);
  }

  try {
    const result = importGraphDocument(payload);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof GraphImportValidationError) {
      console.warn('[API Graph Import] 图谱 JSON 校验失败:', error.message);
      return NextResponse.json(
        { error: '图谱 JSON 校验失败', message: error.message, errors: error.issues },
        { status: 400 }
      );
    }

    console.error('[API Graph Import] 导入图谱失败:', error);
    return NextResponse.json(
      { error: '导入图谱失败', message: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    );
  }
}
