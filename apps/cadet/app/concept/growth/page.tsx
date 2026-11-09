import { GrowthScreen } from '@/components/concept/growth-screen';
import { classHistory } from '@/components/concept/mock-data';

/** `?class=` picks the class; a missing or unknown id falls back to the current class. */
export default async function Page({ searchParams }: { searchParams: Promise<{ class?: string }> }) {
  const { class: classId } = await searchParams;
  const record = classHistory.find((item) => item.id === classId) ?? classHistory.find((item) => item.current)!;
  return <GrowthScreen record={record} />;
}
