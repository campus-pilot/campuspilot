'use client';

import dynamic from 'next/dynamic';

const adminApp = dynamic(() => import('@/components/admin-app'), {
  ssr: false,
});

export default function HomePage() {
  return <adminApp />;
}
