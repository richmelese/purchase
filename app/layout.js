import './globals.css';
import { ToastProvider } from '@/components/ui';

export const metadata = {
  title: 'Epiccenter Trading PLC – Purchase & Sales',
  description: 'Purchases, sales, VAT, withholding and inventory',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
