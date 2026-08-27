import type { Metadata, Viewport } from 'next';
import './globals.css';
import './premium-mobile.css';
import './context-fixes.css';

export const metadata: Metadata = {
  title: 'AnyPhoto',
  description: 'Controle câmeras remotas em tempo real a partir de qualquer dispositivo.',
  applicationName: 'AnyPhoto',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'AnyPhoto' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#05090d',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
