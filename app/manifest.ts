// PWA Web Manifest untuk install ke Home Screen.
import type { MetadataRoute } from "next";

// Manifest PWA TukangCatat.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TukangCatat — Nyatet Duit Tanpa Ribet",
    short_name: "TukangCatat",
    description: "Ketik, suara, atau foto struk. Beres dalam 2 detik.",
    start_url: "/dash",
    display: "standalone",
    background_color: "#1c1917",
    theme_color: "#c2410c",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}