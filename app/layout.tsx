import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "AZLA · 주간회의",
  description:
    "회의의 기록이 제품의 다음이 됩니다. AZLA 사내 주간회의 및 개발 이력 관리",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
