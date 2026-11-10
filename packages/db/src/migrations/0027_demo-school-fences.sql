-- Fail fast instead of queueing behind long transactions: the batch below
-- takes brief exclusive locks on demo tables and on "school" (trigger).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TYPE "public"."demo_school_purge_status" ADD VALUE 'failed';--> statement-breakpoint
ALTER TABLE "demo_school_job" ADD COLUMN "purge_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "demo_school_purge" ADD COLUMN "cleanup_attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_school_purge" ADD COLUMN "last_error" text;--> statement-breakpoint
-- Review 2, L3: is_demo is the fact the demo purge exception rests on (the
-- per-transaction marker from purge_demo_school plus is_demo). It is fixed at
-- creation, so no UPDATE, from any role or app path, can turn a real school
-- into one purge_demo_school would empty, or the reverse.
CREATE OR REPLACE FUNCTION "public"."school_guard_is_demo"()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
	IF NEW."is_demo" IS DISTINCT FROM OLD."is_demo" THEN
		RAISE EXCEPTION 'school.is_demo is immutable after insert';
	END IF;
	RETURN NEW;
END; $$;--> statement-breakpoint
CREATE TRIGGER "school_is_demo_immutable" BEFORE UPDATE OF "is_demo" ON "public"."school" FOR EACH ROW EXECUTE FUNCTION "public"."school_guard_is_demo"();--> statement-breakpoint
COMMENT ON FUNCTION "public"."finance_demo_purge_allows"(text) IS 'True only for a demo school (is_demo, immutable) with a demo_purge_marker row for the current transaction, which only purge_demo_school() inserts (the table is not writable by PUBLIC). The call-stack name check is defence in depth and can be spoofed by a same-named function; it is not the binding.';