'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@campuspilot/ui/components/tabs';

import { AssistantUsageTab } from './assistant-usage-tab';

/**
 * Settings › Usage. One tab today (AI usage); further usage (storage,
 * messaging) gets its own tab here.
 */
export function SchoolUsageTabs({ schoolId }: { schoolId: string }) {
  return (
    <Tabs defaultValue="ai" className="mx-auto w-full max-w-5xl gap-4">
      <TabsList>
        <TabsTrigger value="ai">AI usage</TabsTrigger>
      </TabsList>
      <TabsContent value="ai">
        <AssistantUsageTab schoolId={schoolId} />
      </TabsContent>
    </Tabs>
  );
}
