import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TableFlow — AI Assistant",
  description: "Upload documents and chat with your AI assistant.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
