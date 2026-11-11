import type { Metadata } from 'next';
import { PlatformAiBilling } from '@/components/assistant/platform-ai-billing';

export const metadata: Metadata = {
  title: 'AI billing | CampusPilot Admin',
};

export default function AiBillingPage() {
  return <PlatformAiBilling />;
}
