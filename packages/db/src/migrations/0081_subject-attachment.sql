-- Subjects added from an examination: every class subject now states where it
-- is offered, `attachment` in `class.config.subjects.<slug>`:
-- `{"kind":"school"}` (a classroom subject, offered in every examination) or
-- `{"kind":"exam","exams":[{"sessionId":…,"examSlug":…}]}` (only those
-- examinations). The fact is stored explicitly, never inferred from a missing
-- key, so every subject that existed before this migration was a classroom
-- subject and is backfilled as one. Subjects that already have an attachment
-- are left alone, so running it again changes nothing. `updated_at` is not
-- touched: this is not an edit by a person.
UPDATE "class" AS c
SET "config" = jsonb_set(
	c."config",
	'{subjects}',
	(
		SELECT jsonb_object_agg(
			s.key,
			CASE
				WHEN jsonb_typeof(s.value) <> 'object' OR s.value ? 'attachment' THEN s.value
				ELSE s.value || '{"attachment":{"kind":"school"}}'::jsonb
			END
		)
		FROM jsonb_each(c."config" -> 'subjects') AS s
	)
)
WHERE jsonb_typeof(c."config" -> 'subjects') = 'object'
	AND EXISTS (
		SELECT 1
		FROM jsonb_each(c."config" -> 'subjects') AS s
		WHERE jsonb_typeof(s.value) = 'object' AND NOT (s.value ? 'attachment')
	);
