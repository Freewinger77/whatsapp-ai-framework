import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tyres 4 U",
  description: "Every lead and every booking for the tyre fitting shop, in one place.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
