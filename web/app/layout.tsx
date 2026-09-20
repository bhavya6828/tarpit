import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const jet = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jet', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'TARPIT — Autonomous Scam-Baiter',
  description: 'An AI digital bodyguard that traps phone scammers and harvests their payment infrastructure.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jet.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
