import type { Metadata } from 'next';
import { GrowthScreen } from '@/components/growth/growth-screen';

export const metadata: Metadata = { title: 'Growth' };

/** The server's current class; other classes live at `/growth/class/{recordId}`. */
export default function GrowthPage() {
  return <GrowthScreen />;
}
