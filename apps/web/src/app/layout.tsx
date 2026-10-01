import './globals.css';

import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';

import { Providers } from '@/components/providers';
import { NONCE_HEADER } from '@/lib/security/csp';
import { THEME_INIT_SCRIPT } from '@/lib/theme/theme-store';

export const metadata: Metadata = {
  title: { default: 'PlanIT', template: '%s · PlanIT' },
  description:
    'PlanIT turns goals into scheduled work and measures whether you actually followed through.',
  applicationName: 'PlanIT',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8f9fc' },
    { media: '(prefers-color-scheme: dark)', color: '#111319' },
  ],
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // Reading the per-request nonce also makes every page dynamically rendered, which nonce-based
  // CSP requires.
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;

  return (
    // The theme script adds `dark` to <html> before hydration.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`${GeistSans.variable} ${GeistMono.variable} font-sans`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
