import type { ComponentProps } from "react";
import { WorkspaceNavigationLayout } from "../workspace-navigation-layout";
/** Examination and document workspaces share the admission layout proportions. */
export function ExamNavigationLayout(
  props: ComponentProps<typeof WorkspaceNavigationLayout>,
) {
  return (
    <WorkspaceNavigationLayout
      {...props}
      navigationLabel="Examination sections"
    />
  );
}
