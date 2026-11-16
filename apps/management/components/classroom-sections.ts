/** One section (tab or More menu entry) of a classroom's workspace. */
export type ClassroomSection = {
  id: 'students' | 'teachers' | 'sections' | 'subjects' | 'documents' | 'settings';
  label: string;
  /** Shown as a tab; the rest are in the More menu. */
  primary: boolean;
};

const ALL_SECTIONS: readonly (ClassroomSection & { needsStudentManagement: boolean })[] = [
  { id: 'students', label: 'Students', primary: true, needsStudentManagement: true },
  { id: 'teachers', label: 'Teachers', primary: true, needsStudentManagement: false },
  { id: 'sections', label: 'Sections', primary: true, needsStudentManagement: false },
  { id: 'subjects', label: 'Subjects', primary: false, needsStudentManagement: false },
  { id: 'documents', label: 'Documents', primary: false, needsStudentManagement: true },
  { id: 'settings', label: 'Settings', primary: false, needsStudentManagement: false },
];

/**
 * A classroom's sections, in order, for a school that has student management
 * or not. Without it a classroom has no students to list and no student
 * documents, so those sections are left out; teachers, sections, subjects
 * and settings stay. The first section is the classroom's default.
 */
export function classroomSections(studentManagement: boolean): ClassroomSection[] {
  return ALL_SECTIONS.filter((section) => studentManagement || !section.needsStudentManagement).map(
    ({ needsStudentManagement: _needs, ...section }) => section,
  );
}

/** The classroom's address, optionally of one section. */
export function classroomHref(input: { schoolId: string; sessionId: string; classId: string }, section?: ClassroomSection['id']) {
  const base = `/school/${encodeURIComponent(input.schoolId)}/sessions/${encodeURIComponent(input.sessionId)}/classroom/${encodeURIComponent(input.classId)}`;
  return section ? `${base}/${section}` : base;
}
