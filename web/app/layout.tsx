import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Header } from './(public)/_components/Header';
import { ThemeScript } from './_components/ThemeScript';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-inter',
  display: 'swap',
});
const jbmono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jbmono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ComfyUI Node Wiki',
  description: 'Community-maintained metadata for ComfyUI custom nodes.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh" className={`${inter.variable} ${jbmono.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-screen bg-canvas text-fg-primary">
        <Header />
        {children}
      </body>
    </html>
  );
}