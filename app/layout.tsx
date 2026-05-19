import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "天气预报 AI 助手",
  description: "基于 DeepSeek V4 + AG-UI Protocol 的智能天气预报助手",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
