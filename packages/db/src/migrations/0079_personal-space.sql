-- Personal spaces and standalone question papers (docs/personal-space.md).
-- `school.kind` says whether a school is a real school or one person's
-- personal space (at most one per owner). A standalone paper is an
-- `exam_question_paper` of kind `standalone`: its five exam key columns are
-- null, its details (school, class, subject and exam names) are its own
-- columns, overwritten by every saved version, and its versions have no
-- template revision (they print in the built-in plain shell). The version's
-- `paper_kind` is held equal to its paper's kind by a composite foreign key
-- so its own CHECK can tie the template to the kind. A conversation can be
-- shared with a standalone paper by its id. Existing rows are schools, exam
-- papers and exam versions. The demo purge needs nothing new: these are
-- columns of tables it already clears, and demo schools are never personal.
-- The unique (id, kind) constraint is created before the foreign key that
-- references it.
CREATE TYPE "public"."question_paper_kind" AS ENUM('exam', 'standalone');--> statement-breakpoint
CREATE TYPE "public"."school_kind" AS ENUM('school', 'personal');--> statement-breakpoint
ALTER TABLE "exam_question_paper" ALTER COLUMN "session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_question_paper" ALTER COLUMN "exam_slug" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_question_paper" ALTER COLUMN "class_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_question_paper" ALTER COLUMN "subject_slug" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_question_paper" ALTER COLUMN "mode_slug" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_question_paper_version" ALTER COLUMN "template_revision_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD COLUMN "standalone_paper_id" text;--> statement-breakpoint
ALTER TABLE "exam_question_paper" ADD COLUMN "kind" "question_paper_kind" DEFAULT 'exam' NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_question_paper" ADD COLUMN "details_school_name" text;--> statement-breakpoint
ALTER TABLE "exam_question_paper" ADD COLUMN "details_class_name" text;--> statement-breakpoint
ALTER TABLE "exam_question_paper" ADD COLUMN "details_subject_name" text;--> statement-breakpoint
ALTER TABLE "exam_question_paper" ADD COLUMN "details_exam_name" text;--> statement-breakpoint
ALTER TABLE "exam_question_paper_version" ADD COLUMN "paper_kind" "question_paper_kind" DEFAULT 'exam' NOT NULL;--> statement-breakpoint
ALTER TABLE "school" ADD COLUMN "kind" "school_kind" DEFAULT 'school' NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_question_paper" ADD CONSTRAINT "exam_question_paper_id_kind_unique" UNIQUE("id","kind");--> statement-breakpoint
ALTER TABLE "exam_question_paper_version" ADD CONSTRAINT "exam_question_paper_version_paper_kind_fk" FOREIGN KEY ("paper_id","paper_kind") REFERENCES "public"."exam_question_paper"("id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_conversation_standalone_paper_updated_idx" ON "assistant_conversation" USING btree ("school_id","standalone_paper_id","updated_at") WHERE "assistant_conversation"."standalone_paper_id" is not null and "assistant_conversation"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "exam_question_paper_standalone_idx" ON "exam_question_paper" USING btree ("school_id","updated_at") WHERE "exam_question_paper"."kind" = 'standalone';--> statement-breakpoint
CREATE UNIQUE INDEX "school_personal_owner_unique" ON "school" USING btree ("owner_user_id") WHERE "school"."kind" = 'personal';--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD CONSTRAINT "assistant_conversation_one_shared_paper" CHECK ("assistant_conversation"."standalone_paper_id" is null or "assistant_conversation"."paper_class_id" is null);--> statement-breakpoint
ALTER TABLE "exam_question_paper" ADD CONSTRAINT "exam_question_paper_kind_key_check" CHECK (case "exam_question_paper"."kind"::text
        when 'exam' then num_nonnulls("exam_question_paper"."session_id", "exam_question_paper"."exam_slug", "exam_question_paper"."class_id", "exam_question_paper"."subject_slug", "exam_question_paper"."mode_slug") = 5
          and num_nonnulls("exam_question_paper"."details_school_name", "exam_question_paper"."details_class_name", "exam_question_paper"."details_subject_name", "exam_question_paper"."details_exam_name") = 0
        else num_nulls("exam_question_paper"."session_id", "exam_question_paper"."exam_slug", "exam_question_paper"."class_id", "exam_question_paper"."subject_slug", "exam_question_paper"."mode_slug") = 5
      end);--> statement-breakpoint
ALTER TABLE "exam_question_paper" ADD CONSTRAINT "exam_question_paper_details_length_check" CHECK (coalesce(char_length("exam_question_paper"."details_school_name"), 0) <= 160
        and coalesce(char_length("exam_question_paper"."details_class_name"), 0) <= 160
        and coalesce(char_length("exam_question_paper"."details_subject_name"), 0) <= 160
        and coalesce(char_length("exam_question_paper"."details_exam_name"), 0) <= 160);--> statement-breakpoint
ALTER TABLE "exam_question_paper_version" ADD CONSTRAINT "exam_question_paper_version_template_check" CHECK (("exam_question_paper_version"."paper_kind"::text = 'standalone') = ("exam_question_paper_version"."template_revision_id" is null));--> statement-breakpoint
ALTER TABLE "school" ADD CONSTRAINT "school_personal_not_demo_check" CHECK ("school"."kind"::text <> 'personal' or not "school"."is_demo");