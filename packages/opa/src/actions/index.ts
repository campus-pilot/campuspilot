import { classActions } from './class';
import { schoolActions } from './school';
import { systemActions } from './system';

export { classActions, type ClassAction } from './class';
export { schoolActions, type SchoolAction } from './school';
export { systemActions, type SystemAction } from './system';

/** Actions are grouped by the resource level at which they are evaluated. */
export const authorizationActions = {
  system: systemActions,
  school: schoolActions,
  class: classActions,
} as const;
