import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Crop Studio — Image cropper',
  description: 'A simple, private image cropper for single and bulk edits.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
