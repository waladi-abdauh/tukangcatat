import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono, Playpen_Sans_Arabic } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const script = Playpen_Sans_Arabic({
  variable: "--font-playpen",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Basis untuk meresolve URL og:image relatif (ikut URL tunnel/produksi).
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "TukangCatat — Partner Nyatet Duit via WhatsApp",
    template: "%s | TukangCatat",
  },
  description:
    "Ketik, suara, atau foto struk — duit kepantau, nggak perlu hafal. Rekap pengeluaran otomatis langsung dari WhatsApp. Tanpa install, tanpa ribet.",
  applicationName: "TukangCatat",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TukangCatat",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="id"
      className={`${geistSans.variable} ${geistMono.variable} ${script.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
