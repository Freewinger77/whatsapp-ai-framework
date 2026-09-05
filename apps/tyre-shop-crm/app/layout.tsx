import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tyres 4 U · SMT CRM",
  description: "Sell More Tyres CRM dashboard for Tyres 4 U",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
