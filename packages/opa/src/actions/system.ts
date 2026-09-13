export const systemActions = {
  listSchools: 'system.school.list',
  readSchool: 'system.school.read',
  createSchool: 'system.school.create',
  updateSchool: 'system.school.update',
  updateSchoolLogo: 'system.school.logo.update',
  deleteSchool: 'system.school.delete',
} as const;

export type SystemAction = (typeof systemActions)[keyof typeof systemActions];
