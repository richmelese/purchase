import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Epiccenter Trading PLC – Purchase & Sales',
  description: 'Purchases, sales, VAT, withholding and inventory',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
