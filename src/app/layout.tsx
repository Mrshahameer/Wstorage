import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Wisko DAM",
  description: "Internal Digital Asset Management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
