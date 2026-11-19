import type { Metadata, Viewport } from "next";
import { LocalDates } from "@/components/local-dates";
import "./globals.css";
import "@/components/user-management.css";
export const metadata: Metadata = {
  title: "Curated Financial · CRM",
  description: "Financing, thoughtfully managed.",
  icons: { icon: "/icon.svg", apple: "/icon-180.png" },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0B0B0B",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <LocalDates>{children}</LocalDates>
      </body>
    </html>
  );
}
