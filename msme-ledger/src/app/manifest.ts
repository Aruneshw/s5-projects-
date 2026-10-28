// src/app/manifest.ts — PWA web app manifest (served at /manifest.webmanifest).
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MSME Digital Accounting Ledger",
    short_name: "MSME Ledger",
    description: "Billing, ledger, stock and working capital for a vegetable wholesale business.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f5ef",
    theme_color: "#16633a",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "New sales bill", url: "/bills/new?type=SALES" },
      { name: "New purchase bill", url: "/bills/new?type=PURCHASE" },
    ],
  };
}
