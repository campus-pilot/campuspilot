import { z } from 'zod';
import {
  examNameKey,
  examSlugSchema,
  findExamNameClash,
} from '@campuspilot/db/schema/jsonb/session-config';

/** Shown next to the slug when another exam of the draft has it. */
export const EXAM_DIALOG_SLUG_TAKEN_MESSAGE =
  'An examination with this slug already exists.';

/** Shown next to the name when another exam of the draft has it (`examNameKey`). */
export const EXAM_DIALOG_NAME_TAKEN_MESSAGE =
  'An examination with this name already exists.';

/**
 * The rules of the session settings Add / Edit examination dialog, checked
 * against `examConfig`, the settings draft the dialog edits (keyed by slug).
 * `editingSlug` is the exam being edited, or undefined when adding one.
 *
 * The slug rule is shared with the Examinations list and `school.createExam`
 * (`examSlugSchema`); a slug another exam has is refused. Exam names are
 * unique within a session, compared trimmed and ignoring case
 * (`examNameKey`), and the dialog applies the rule the settings save
 * (`school.updateSession`) enforces: only a clash the edit introduces is
 * refused. An exam kept under its slug with the same name (changing only case
 * or surrounding whitespace) is never refused, so an exam stored before names
 * had to be unique can still be edited while a duplicate of it exists. A
 * changed slug makes it a new exam for the server, so its name is checked
 * then too. The server stays the authority: it compares with the stored
 * configuration, not this draft.
 */
export function examDialogSchema({
  examConfig,
  editingSlug,
}: {
  examConfig: Readonly<Record<string, { name: string }>>;
  editingSlug?: string;
}) {
  const editing = editingSlug === undefined ? undefined : examConfig[editingSlug];
  return z
    .object({
      name: z.string().trim().min(1, 'Exam name is required'),
      slug: examSlugSchema,
    })
    .superRefine((values, context) => {
      const keepsSlug = editing !== undefined && values.slug === editingSlug;
      if (!keepsSlug && Object.hasOwn(examConfig, values.slug))
        context.addIssue({
          code: 'custom',
          message: EXAM_DIALOG_SLUG_TAKEN_MESSAGE,
          path: ['slug'],
        });
      const keepsName =
        keepsSlug && examNameKey(values.name) === examNameKey(editing!.name);
      if (
        !keepsName &&
        findExamNameClash(examConfig, values.name, editingSlug) !== undefined
      )
        context.addIssue({
          code: 'custom',
          message: EXAM_DIALOG_NAME_TAKEN_MESSAGE,
          path: ['name'],
        });
    });
}
