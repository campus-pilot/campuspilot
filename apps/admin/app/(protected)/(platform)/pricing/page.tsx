import type { Metadata } from 'next';
import { SubscriptionPricing } from '@/components/pricing/subscription-pricing';

export const metadata: Metadata = {
  title: 'Pricing | CampusPilot Admin',
};

export default function PricingPage() {
  return <SubscriptionPricing />;
}
