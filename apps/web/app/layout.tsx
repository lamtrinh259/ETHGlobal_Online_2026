import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { AppShell } from "./AppShell";
import { loadWebConfig } from "@/lib/config";

const TAGLINE = "References that cannot be deleted";
const PITCH =
  "A reference from a verified human, signed into a permanent public name — checkable by anyone, unfakeable at scale.";

export const metadata: Metadata = {
  title: { default: `Ketsuban — ${TAGLINE}`, template: "%s · ketsuban" },
  description: PITCH,
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  openGraph: { type: "website", siteName: "ketsuban", title: `Ketsuban — ${TAGLINE}`, description: PITCH },
  twitter: { card: "summary", title: `Ketsuban — ${TAGLINE}`, description: PITCH },
  manifest: "/site.webmanifest",
  appleWebApp: { capable: true, title: "Ketsuban", statusBarStyle: "black-translucent" },
  other: { "apple-mobile-web-app-capable": "yes" },
  icons: { icon: [{ url: "/mark.svg", type: "image/svg+xml" }], apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#060a18",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const config = loadWebConfig();
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* No-FOUC: stamp the saved theme on <html> before first paint. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var m=localStorage.getItem('ketsuban.theme');if(m==='light'||m==='dark')document.documentElement.dataset.theme=m;}catch(e){}})();`,
          }}
        />
        <Providers config={config}>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
