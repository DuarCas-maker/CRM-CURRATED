import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["exceljs", "pdf-lib"],
  async headers() {
    const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
      : "";
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "Cache-Control", value: "no-store" },
          {
            key: "Content-Security-Policy",
            // Chrome checks the Google redirect after the same-origin OAuth form submission.
            value: `default-src 'self'; script-src 'self' 'unsafe-inline' ${process.env.NODE_ENV === "development" ? "'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ${supabaseOrigin} ${supabaseOrigin.replace(/^http/, "ws")} ${process.env.NODE_ENV === "development" ? "ws://localhost:* ws://127.0.0.1:*" : ""}; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://accounts.google.com`,
          },
        ],
      },
    ];
  },
};
export default config;
