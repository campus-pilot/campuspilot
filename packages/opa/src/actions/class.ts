export const classActions = {
  addStudent: 'class.student.add',
} as const;

export type ClassAction = (typeof classActions)[keyof typeof classActions];
