import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Shortlist",
  description:
    "Three thoughtful introductions a week, from people verified through eLitmus. No swiping.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col antialiased`}
      >
        <header className="border-b">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Shortlist
            </Link>
            <span className="text-muted-foreground text-xs">
              by eLitmus (demo)
            </span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
          {children}
        </main>
        <footer className="text-muted-foreground border-t py-6 text-center text-xs">
          Demo environment. Test data only.
        </footer>
      </body>
    </html>
  );
}
