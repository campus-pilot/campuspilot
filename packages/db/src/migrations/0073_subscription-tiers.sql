-- Subscription tiers (docs/feature-flags.md). A school's features now come
-- from its tier (`school.tier`); `school_feature_flag.enabled` becomes the
-- school's adjustment to that tier (true: on, false: off, null: follow the
-- tier). This migration puts every existing school on a tier and rewrites
-- its rows so that **no school gains or loses a feature on deploy**.
ALTER TABLE "school_feature_flag" ALTER COLUMN "enabled" DROP NOT NULL;--> statement-breakpoint
-- Null: the school has no subscribed tier. Every existing school gets one below.
ALTER TABLE "school" ADD COLUMN "tier" text;--> statement-breakpoint
ALTER TABLE "school" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "school" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "school" ADD COLUMN "suspended_by" text;--> statement-breakpoint
ALTER TABLE "school" ADD CONSTRAINT "school_suspended_by_user_id_fk" FOREIGN KEY ("suspended_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- 1. The tier of every existing school: the lowest one that covers what the
--    school has today. Before tiers a school without a stored row had student
--    management and nothing else, so a missing row reads as that here.
--    Enterprise: the Cadet Portal is in use (it needs student management);
--    Pro: student management without the portal; Plus: neither.
UPDATE "school" AS s
SET "tier" = CASE
		WHEN had."student_management" AND had."cadet" THEN 'enterprise'
		WHEN had."student_management" THEN 'pro'
		ELSE 'plus'
	END
FROM (
	SELECT
		sc."id",
		coalesce((SELECT f."enabled" FROM "school_feature_flag" f WHERE f."school_id" = sc."id" AND f."feature" = 'studentManagement'), true) AS "student_management",
		coalesce((SELECT f."enabled" FROM "school_feature_flag" f WHERE f."school_id" = sc."id" AND f."feature" = 'cadet'), false) AS "cadet"
	FROM "school" sc
) AS had
WHERE had."id" = s."id";--> statement-breakpoint
-- 2. Keep what each school has where its new tier says otherwise, as an
--    adjustment. `was_on` is the school's switch before tiers (a missing row
--    was on only for student management); `in_tier` is the new tier's answer.
--    WhatsApp was not a per-school feature: it went to every school with
--    student management, so those schools keep it when their tier does not
--    include it. A school without student management sent no WhatsApp and
--    gets no adjustment. A row that already exists holds exactly `was_on`,
--    so only missing rows are written.
INSERT INTO "school_feature_flag" ("school_id", "feature", "enabled", "config", "updated_by")
SELECT had."school_id", had."feature", had."was_on", NULL, NULL
FROM (
	SELECT
		s."id" AS "school_id",
		k."feature",
		CASE
			WHEN k."feature" = 'whatsapp' THEN s."tier" <> 'plus'
			ELSE coalesce(f."enabled", k."feature" = 'studentManagement')
		END AS "was_on",
		CASE k."feature"
			WHEN 'studentManagement' THEN s."tier" IN ('pro', 'enterprise')
			WHEN 'notices' THEN s."tier" IN ('pro', 'enterprise')
			WHEN 'cadet' THEN s."tier" = 'enterprise'
			WHEN 'whatsapp' THEN s."tier" = 'enterprise'
		END AS "in_tier"
	FROM "school" s
	CROSS JOIN (VALUES ('studentManagement'), ('cadet'), ('notices'), ('whatsapp')) AS k("feature")
	LEFT JOIN "school_feature_flag" f ON f."school_id" = s."id" AND f."feature" = k."feature"
) AS had
WHERE had."was_on" <> had."in_tier"
ON CONFLICT ("school_id", "feature") DO NOTHING;--> statement-breakpoint
-- 3. A stored switch that says what the tier already says is not an
--    adjustment: the school follows its tier from now on, so a later tier
--    change applies to it. These three features have no settings, so the row
--    holds nothing else and is removed. (The assistant is in no tier; its
--    rows stay as they are: on or off per school, with its settings.)
DELETE FROM "school_feature_flag" f
USING "school" s
WHERE s."id" = f."school_id"
	AND f."config" IS NULL
	AND (
		(f."feature" = 'studentManagement' AND f."enabled" = (s."tier" IN ('pro', 'enterprise')))
		OR (f."feature" = 'notices' AND f."enabled" = (s."tier" IN ('pro', 'enterprise')))
		OR (f."feature" = 'cadet' AND f."enabled" = (s."tier" = 'enterprise'))
	);--> statement-breakpoint
ALTER TABLE "school" ADD CONSTRAINT "school_tier_check" CHECK ("school"."tier" is null or "school"."tier" in ('plus', 'pro', 'enterprise'));--> statement-breakpoint
ALTER TABLE "school" ADD CONSTRAINT "school_suspension_reason_check" CHECK (("school"."suspended_at" is null) = ("school"."suspended_reason" is null));--> statement-breakpoint
-- The assistant's roles become one list per school
-- (`school_assistant_access_role`), edited by the platform administrator and
-- the school's principal alike. Until now a role could use the assistant
-- only when the administrator made it eligible (`config.eligibleRoles` of
-- the `assistant` flag) AND the school switched it on.
-- 4. A switched-on role that was not eligible granted nothing; it must not
--    start granting access now.
DELETE FROM "school_assistant_access_role" a
WHERE NOT EXISTS (
	SELECT 1
	FROM "school_feature_flag" f
	CROSS JOIN LATERAL jsonb_array_elements_text(
		CASE WHEN jsonb_typeof(f."config" -> 'eligibleRoles') = 'array' THEN f."config" -> 'eligibleRoles' ELSE '[]'::jsonb END
	) AS eligible("role")
	WHERE f."school_id" = a."school_id" AND f."feature" = 'assistant' AND eligible."role" = a."role"
);--> statement-breakpoint
-- 5. A school whose assistant is on, whose administrator made roles eligible
--    and where none is switched on gets those roles switched on: what the
--    administrator enabled is enabled for the school. A school that has a
--    role switched on keeps exactly its own choice. A school whose assistant
--    is off gets no row: switching it on later then switches on the default
--    roles. `eligibleRoles` stays in the stored assistant config (the new
--    config schema ignores it), so an API of the previous release still reads
--    the assistant rows while this one rolls out.
INSERT INTO "school_assistant_access_role" ("school_id", "role", "updated_by")
SELECT f."school_id", eligible."role", NULL
FROM "school_feature_flag" f
CROSS JOIN LATERAL jsonb_array_elements_text(
	CASE WHEN jsonb_typeof(f."config" -> 'eligibleRoles') = 'array' THEN f."config" -> 'eligibleRoles' ELSE '[]'::jsonb END
) AS eligible("role")
WHERE f."feature" = 'assistant'
	AND f."enabled" = true
	AND eligible."role" IN ('principal', 'manager', 'teacher', 'accountant', 'exam_coordinator')
	AND NOT EXISTS (SELECT 1 FROM "school_assistant_access_role" a WHERE a."school_id" = f."school_id")
ON CONFLICT DO NOTHING;
