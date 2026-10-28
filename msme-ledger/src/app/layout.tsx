// src/app/layout.tsx — root HTML shell.
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: { default: "MSME Ledger", template: "%s · MSME Ledger" },
  description: "Vegetable trading ledger, billing, stock and working-capital tools for a family MSME.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "MSME Ledger", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#16633a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
