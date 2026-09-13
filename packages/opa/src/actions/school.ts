export const schoolActions = {
  inviteMember: 'school.member.invite',
} as const;

export type SchoolAction = (typeof schoolActions)[keyof typeof schoolActions];
