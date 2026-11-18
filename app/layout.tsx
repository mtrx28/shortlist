import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { getAppUrl } from "@/lib/env";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description =
  "Three thoughtful introductions a week, from people verified through eLitmus. No swiping, no endless feed, and an honest way to end a conversation.";

export const metadata: Metadata = {
  metadataBase: new URL(getAppUrl()),
  title: "Shortlist: three introductions a week, not three hundred",
  description,
  applicationName: "Shortlist",
  openGraph: {
    type: "website",
    siteName: "Shortlist",
    title: "Shortlist: three introductions a week, not three hundred",
    description,
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: "Shortlist: three introductions a week, not three hundred",
    description,
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "Shortlist", statusBarStyle: "default" },
};

// The browser bar colour on phones (the brand teal).
export const viewport: Viewport = {
  themeColor: "#0b5d63",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="flex min-h-screen flex-col antialiased">
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <header className="border-b">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Shortlist
            </Link>
            <nav
              aria-label="Main"
              className="text-muted-foreground flex items-center gap-4 text-sm"
            >
              <Link href="/demo" className="hover:text-foreground underline">
                Demo guide
              </Link>
              <Link href="/plus" className="hover:text-foreground underline">
                Plus
              </Link>
              <span className="hidden text-xs sm:inline">
                by eLitmus (demo)
              </span>
            </nav>
          </div>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 outline-none sm:py-12"
        >
          {children}
        </main>
        <footer className="text-muted-foreground space-y-2 border-t py-6 text-center text-xs">
          <nav
            aria-label="Policies"
            className="flex flex-wrap justify-center gap-x-4 gap-y-1"
          >
            <Link href="/terms" className="underline">
              Terms
            </Link>
            <Link href="/privacy" className="underline">
              Privacy
            </Link>
            <Link href="/community-rules" className="underline">
              Community rules
            </Link>
            <Link href="/safety" className="underline">
              Safety tips
            </Link>
            <Link href="/grievance" className="underline">
              Grievance and contact
            </Link>
            <Link href="/demo" className="underline">
              Demo guide
            </Link>
          </nav>
          <p>Demo environment. Test data only.</p>
        </footer>
      </body>
    </html>
  );
}
