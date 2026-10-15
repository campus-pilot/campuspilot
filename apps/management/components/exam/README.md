# Examinations

The management routes support exam definitions, class/subject plans and their
lifecycle, the shared timetable, current rosters, historical saved results,
individual marks entry, unsaved previews, saved previews, approval/revocation,
and permitted corrections/deletions. Governance and result actions use typed
permission decisions plus independent session and plan guards.

Forms use TanStack Form and Zod. The shared timetable is held as a whole grid;
selecting one class does not discard other columns. Result saves replace the
full marks/grades/attendance payload and send explicit approval intent. Dirty
editors reset only after deliberate save/reload. Browser history protection
uses cancelable native navigation events where supported; refresh uses the
browser's before-unload prompt.

Desktop batch entry, composite exam previews, and calculated academic grades
are optional extensions and are not included. Publishing and document/export
workflows remain outside this feature.

Focused tests (from the repository root):

```sh
pnpm dlx tsx@4.23.13 --tsconfig apps/management/tsconfig.exam-tests.json --test apps/management/components/exam/exam-validation.test.ts
pnpm --filter management check-types
pnpm --filter @campuspilot/components check-types
pnpm --filter management build
```

Live role checks require the examination backend and representative accounts.
Real-device QA should cover numeric keyboards, the sticky save bar, and
320/360/390px layouts from the specification.
