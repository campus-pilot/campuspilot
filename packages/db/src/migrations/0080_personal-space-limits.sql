ALTER TABLE "user" ADD COLUMN "personal_space_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exam_question_paper_page" ADD COLUMN "thumb_byte_size" integer;--> statement-breakpoint
ALTER TABLE "exam_question_paper_page" ADD CONSTRAINT "exam_question_paper_page_thumb_size_check" CHECK ("exam_question_paper_page"."thumb_byte_size" is null or ("exam_question_paper_page"."thumb_s3_key" is not null and "exam_question_paper_page"."thumb_byte_size" >= 1));--> statement-breakpoint
-- school.kind is set when the row is created and never changes (docs/personal-space.md). The API caches a school's
-- kind in process for that reason (readSchoolKind), so the database guarantees it: no UPDATE, from any role or app
-- path, can turn a real school into a personal space or the reverse.
CREATE OR REPLACE FUNCTION "public"."school_guard_kind"()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
	IF NEW."kind" IS DISTINCT FROM OLD."kind" THEN
		RAISE EXCEPTION 'school.kind is immutable after insert';
	END IF;
	RETURN NEW;
END; $$;--> statement-breakpoint
CREATE TRIGGER "school_kind_immutable" BEFORE UPDATE OF "kind" ON "public"."school" FOR EACH ROW EXECUTE FUNCTION "public"."school_guard_kind"();
