import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Wstorage",
  description: "Secure internal file storage",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
