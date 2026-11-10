# Examination timetable publishing

An examination's timetable (`exam_timetable`, one per exam, shared by all
classes) is a **draft** until staff publish it. Publishing shows it to students
in the Cadet Portal and notifies people; it follows the examination, not
notices, so it has no feature flag of its own.

Where this guide and the code disagree, the code wins.

## Lifecycle

`draft ⇄ published`. The state is `exam_timetable.published_at` (null = draft),
its own fact, never derived from the exam's lifecycle `status`.

| Step | Procedure | Rules |
| --- | --- | --- |
| Draft | `saveExamTimetable`, `deleteExamTimetable` | Only while the timetable is a draft **and** the exam has not ended (`ready` or `active`). |
| Publish | `publishExamTimetable` | Draft only, at least one slot, exam not ended. Sets `published_at`, `published_by` and bumps `publication_count`. Notifies in the same transaction. |
| Withdraw | `withdrawExamTimetable` | Back to a draft; hides it from students; notifies nobody. Exam not ended. |
| Preview | `previewExamTimetablePublish` | Counts staff and the students' per-channel forecast. |

A published timetable is frozen: withdraw it first to change it. Once the exam
is completed (`requireExamNotEnded`) nothing can be drafted, published or
withdrawn; a timetable published before then stays published. Permission:
`school.exam.timetable.publish` (principal, manager, exam coordinator); editing
a draft stays `school.exam.timetable.update`. Document generation (admit cards,
the Timetable PDF) is unchanged and reads the timetable whether or not it is
published.

## Notifications

`notifications/emitters/exam-timetable.ts`, emitted in the publish transaction:

- `exam.timetable_published_staff` (in-app): every school member.
- `exam.timetable_published` (in-app, web push, WhatsApp text): one event per
  registered student enrolled in the timetable's session, whatever their class
  (every student may read every class). **Only while the school has the `cadet`
  feature**; with it off only the staff event is emitted, and switching it on
  later notifies nobody retroactively.

Every publication notifies: keys are `exam-timetable[-staff]:{timetableId}:{publication_count}:…`,
so a replay never notifies twice but publishing again after a withdrawal does.
There is no WhatsApp document attachment (the portal links to the PDF) and no
grouped batch alert; an individual failed WhatsApp copy alerts the `results`
failure topic.

## Cadet Portal

`cadet-timetables.router.ts`: `listTimetables`, `getTimetable`,
`getTimetableDownload`. A student sees a timetable only when it is published and
they are enrolled in its session, then sees **every** class. Visibility is
evaluated on each read, so a withdrawn timetable answers NOT_FOUND even from an
old notification link. The PDF uses the school's selected Timetable template
and is cached in S3 under `schools/{id}/exam-timetables/{timetable}-{publication}-{template}.pdf`.
Screens: `apps/cadet` `/timetables` and `/timetables/{sessionId}/{examSlug}`
(linked from More and the notification).

## Management

The exam's timetable page shows Draft / Published, and its actions menu offers
Publish and Withdraw to draft (dialogs in `exam-timetable-publication.tsx`);
the staff notification opens that page.

## Demo schools

The demo seed publishes the timetable of every exam that is not upcoming and
leaves the upcoming exam's as a draft.
