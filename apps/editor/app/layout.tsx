import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '股市产研图谱',
  description: '面向产业链、概念和上市公司暴露关系的产研图谱工作台',
};

/**
 * 根布局组件。
 * @param props.children 页面内容。
 * @returns 带有全局样式和中文语言标记的 HTML 结构。
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
