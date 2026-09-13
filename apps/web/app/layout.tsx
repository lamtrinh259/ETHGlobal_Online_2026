import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { AppShell } from "./AppShell";
import { loadWebConfig, siteUrl } from "@/lib/config";

const TAGLINE = "Vouches that cannot be deleted";
const PITCH =
  "A vouch from a verified human, signed into a permanent public name — checkable by anyone, unfakeable at scale.";

export const metadata: Metadata = {
  title: { default: `ShibbolETH — ${TAGLINE}`, template: "%s · ShibbolETH" },
  description: PITCH,
  // A card names an absolute URL or names nothing a client can fetch.
  metadataBase: new URL(siteUrl() || "http://localhost:3000"),
  openGraph: {
    type: "website",
    siteName: "ShibbolETH",
    title: `ShibbolETH — ${TAGLINE}`,
    description: PITCH,
    images: [{ url: "/banner.jpg", width: 1376, height: 768, alt: "ShibbolETH" }],
  },
  twitter: {
    card: "summary_large_image",
    title: `ShibbolETH — ${TAGLINE}`,
    description: PITCH,
    images: ["/banner.jpg"],
  },
  manifest: "/site.webmanifest",
  appleWebApp: { capable: true, title: "ShibbolETH", statusBarStyle: "black-translucent" },
  other: { "apple-mobile-web-app-capable": "yes" },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
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
