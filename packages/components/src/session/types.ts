import type {
  FinanceClassOverrides,
  FinanceElement,
  FinanceRecurring,
  FinanceRequiredLevel,
  FinanceSchemaConfig,
  FinanceScope,
  FinanceValuesMap,
  PersistedFinanceSchemaConfig,
} from '@campuspilot/db/schema/jsonb/finance-config';

export type {
  FinanceClassOverrides,
  FinanceElement,
  FinanceRecurring,
  FinanceRequiredLevel,
  FinanceSchemaConfig,
  FinanceScope,
  FinanceValuesMap,
  PersistedFinanceSchemaConfig,
};

export interface SessionFinanceClassDto {
  slug: string;
  label: string;
}

export interface SchoolSessionFinanceDto {
  schoolId: string;
  sessionId: string;
  financeConfig: PersistedFinanceSchemaConfig | null;
  configurationReadiness: {
    status: 'not_configured' | 'incomplete' | 'ready';
    readyForBilling: boolean;
    missingFields: Array<'currency' | 'timeZone' | 'cycleStartMonth'>;
  };
  classOverrides: FinanceClassOverrides;
  classes: SessionFinanceClassDto[];
}

export interface ExamDefinition {
  name: string;
  order: number;
}

export interface CoScholasticArea {
  name: string;
}

export interface GradeDefinition {
  label: string;
  minScore: number;
}

export interface AttendanceTrackingConfig {
  enabled: boolean;
}

export interface SessionConfig {
  examConfig?: Record<string, ExamDefinition>;
  coScholasticAreas?: Record<string, CoScholasticArea>;
  gradingScale?: Record<string, GradeDefinition>;
  attendanceTracking?: AttendanceTrackingConfig;
}

export interface SchoolSessionDto {
  id: string;
  schoolId: string;
  sessionStartYear: number;
  sessionEndYear: number;
  sessionConfig: SessionConfig | null;
  isActive: boolean;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

/** New drafts deliberately leave independent billing facts unconfigured. */
export const DEFAULT_FINANCE_CONFIG: PersistedFinanceSchemaConfig = {
  recurring: 'monthly',
  elements: {},
};

/** Scope options for fee elements */
export const SCOPE_OPTIONS: { value: FinanceScope; label: string }[] = [
  { value: 'school', label: 'School' },
  { value: 'class', label: 'Class' },
  { value: 'student', label: 'Student' },
];

/** Labels for required level */
export const REQUIRED_LEVEL_LABELS: Record<string, string> = {
  school: 'School',
  class: 'Class',
  student: 'Student',
  bill_generation: 'While Bill Generation',
};

/** Example fee element blueprints for quick initialization */
export const EXAMPLE_ELEMENTS: Array<{
  name: string;
  slug: string;
  scopes: FinanceScope[];
  requiredAtLevel?: FinanceRequiredLevel;
  defaultAmountMinor?: number;
  description: string;
}> = [
  {
    name: 'Tuition Fee',
    slug: 'tuition_fee',
    scopes: ['class', 'student'],
    requiredAtLevel: 'class',
    description:
      'Varies by class. Each class must set a tuition amount. Can be overridden per student for scholarships or adjustments.',
  },
  {
    name: 'Transport Fee',
    slug: 'transport_fee',
    scopes: ['student'],
    requiredAtLevel: 'student',
    description:
      'Only configured per student since routes vary. Set an amount after choosing the session currency.',
  },
  {
    name: 'Playground Fee',
    slug: 'playground_fee',
    scopes: ['school'],
    requiredAtLevel: 'school',
    description:
      'A flat fee set once at the school/session level. Applies uniformly to all students.',
  },
  {
    name: 'Lab Fee',
    slug: 'lab_fee',
    scopes: ['class', 'student'],
    requiredAtLevel: 'class',
    description:
      'Filled per class at the time of bill generation. Useful when the amount is only known when the bill is created.',
  },
  {
    name: 'Examination Fee',
    slug: 'examination_fee',
    scopes: ['class'],
    requiredAtLevel: 'bill_generation',
    description:
      'Varies by class. But need to configured when generating bills.',
  },
];

/** Recommended default grading scale sorted descending by minScore */
export const DEFAULT_GRADES: Array<{
  key: string;
  value: { label: string; minScore: number };
}> = [
  { key: 'a1', value: { label: 'A1', minScore: 91 } },
  { key: 'a2', value: { label: 'A2', minScore: 81 } },
  { key: 'b1', value: { label: 'B1', minScore: 71 } },
  { key: 'b2', value: { label: 'B2', minScore: 61 } },
  { key: 'c1', value: { label: 'C1', minScore: 51 } },
  { key: 'c2', value: { label: 'C2', minScore: 41 } },
  { key: 'd', value: { label: 'D', minScore: 33 } },
  { key: 'e', value: { label: 'E', minScore: 0 } },
];

/** Recommended default examinations with predefined ordering */
export const DEFAULT_EXAMINATIONS: Array<{
  slug: string;
  name: string;
  order: number;
}> = [
  {
    slug: 'first_term_examination',
    name: 'First Term Examination',
    order: 1,
  },
  {
    slug: 'second_term_examination',
    name: 'Second Term Examination',
    order: 2,
  },
  {
    slug: 'annual_examination',
    name: 'Annual Examination',
    order: 3,
  },
];

/** Recommended default co-scholastic assessment areas */
export const DEFAULT_CO_SCHOLASTIC_AREAS: Array<{
  slug: string;
  name: string;
}> = [
  { slug: 'discipline', name: 'Discipline' },
  { slug: 'art_education', name: 'Art Education' },
  { slug: 'work_education', name: 'Work Education' },
  {
    slug: 'health_and_physical_education',
    name: 'Health and Physical Education',
  },
];

/** Slugify helper converting names to url/config friendly identifiers */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
