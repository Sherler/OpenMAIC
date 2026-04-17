import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'OpenMAIC Viewer',
  description: 'Read-only classroom viewer for OpenMAIC generated resources',
};

export default function ViewerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
