import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/sidebar';
import { cn } from "@/lib/utils";
import { getTokens, buildThemeCss, googleFontsHref } from '@/lib/theme/tokens';

const tokens = getTokens();

export const metadata: Metadata = {
  title: `${tokens.brand.name} Platform`,
  description: 'The operating system for your digital presence.',
  robots: 'noindex, nofollow',
};

// Runs before paint: applies the persisted theme (default dark) to <html>
// so there is no flash of the wrong theme.
const THEME_SCRIPT = `try{var t=localStorage.getItem("dh-theme");document.documentElement.classList.toggle("dark",t!=="light")}catch(e){document.documentElement.classList.add("dark")}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={cn("dark", "font-sans")}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={googleFontsHref(tokens)} />
        <style
          id="theme-tokens"
          dangerouslySetInnerHTML={{ __html: buildThemeCss(tokens) }}
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="bg-minimal-bg text-white font-sans h-screen w-screen overflow-hidden flex antialiased">
        <Sidebar />
        <main className="flex-1 flex flex-col h-full overflow-hidden">
          {children}
        </main>
      </body>
    </html>
  );
}
