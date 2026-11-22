-- Quick papers in real schools (docs/question-papers.md "Quick papers in a
-- school"). A standalone paper of a real school prints with the school's
-- question paper template, so how a paper prints becomes its own fact,
-- `print_layout` (`school_template` | `plain`), set at creation and never
-- changed. A quick paper belongs to the session it was created in
-- (`session_id`), which its template prints; a personal space's papers keep a
-- null session and the plain shell. The maximum marks a standalone paper
-- states is a fifth detail (`details_max_marks`). A version's
-- `paper_print_layout` is held equal to its paper's by a composite foreign
-- key, so the version's CHECK ties the pinned template to the layout instead
-- of the kind. A quick paper's version keeps the details its heading printed
-- (`printed_details`), so an old version prints as it was saved. Every
-- existing standalone paper is in a personal space: it and its versions are
-- backfilled to `plain`. The unique (id, print_layout)
-- constraint is created before the foreign key that references it.
CREATE TYPE "public"."question_paper_print_layout" AS ENUM('school_template', 'plain');--> statement-breakpoint
ALTER TABLE "exam_question_paper" DROP CONSTRAINT "exam_question_paper_kind_key_check";--> statement-breakpoint
ALTER TABLE "exam_question_paper_version" DROP CONSTRAINT "exam_question_paper_version_template_check";--> statement-breakpoint
ALTER TABLE "exam_question_paper" ADD COLUMN "print_layout" "question_paper_print_layout" DEFAULT 'school_template' NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_question_paper" ADD COLUMN "details_max_marks" integer;--> statement-breakpoint
ALTER TABLE "exam_question_paper_version" ADD COLUMN "paper_print_layout" "question_paper_print_layout" DEFAULT 'school_template' NOT NULL;--> statement-breakpoint
UPDATE "exam_question_paper" SET "print_layout" = 'plain' WHERE "kind"::text = 'standalone';--> statement-breakpoint
UPDATE "exam_question_paper_version" SET "paper_print_layout" = 'plain' WHERE "paper_kind"::text = 'standalone';--> statement-breakpoint
ALTER TABLE "exam_question_paper" ADD CONSTRAINT "exam_question_paper_id_print_layout_unique" UNIQUE("id","print_layout");--> statement-breakpoint
ALTER TABLE "exam_question_paper_version" ADD CONSTRAINT "exam_question_paper_version_paper_print_layout_fk" FOREIGN KEY ("paper_id","paper_print_layout") REFERENCES "public"."exam_question_paper"("id","print_layout") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exam_question_paper_quick_idx" ON "exam_question_paper" USING btree ("school_id","session_id","updated_at") WHERE "exam_question_paper"."kind" = 'standalone' and "exam_question_paper"."session_id" is not null;--> statement-breakpoint
ALTER TABLE "exam_question_paper" ADD CONSTRAINT "exam_question_paper_details_max_marks_check" CHECK ("exam_question_paper"."details_max_marks" is null or "exam_question_paper"."details_max_marks" between 1 and 10000);--> statement-breakpoint
ALTER TABLE "exam_question_paper" ADD CONSTRAINT "exam_question_paper_kind_key_check" CHECK (case "exam_question_paper"."kind"::text
        when 'exam' then num_nonnulls("exam_question_paper"."session_id", "exam_question_paper"."exam_slug", "exam_question_paper"."class_id", "exam_question_paper"."subject_slug", "exam_question_paper"."mode_slug") = 5
          and num_nonnulls("exam_question_paper"."details_school_name", "exam_question_paper"."details_class_name", "exam_question_paper"."details_subject_name", "exam_question_paper"."details_exam_name", "exam_question_paper"."details_max_marks") = 0
          and "exam_question_paper"."print_layout"::text = 'school_template'
        else num_nulls("exam_question_paper"."exam_slug", "exam_question_paper"."class_id", "exam_question_paper"."subject_slug", "exam_question_paper"."mode_slug") = 4
          and ("exam_question_paper"."session_id" is null) = ("exam_question_paper"."print_layout"::text = 'plain')
      end);--> statement-breakpoint
ALTER TABLE "exam_question_paper_version" ADD CONSTRAINT "exam_question_paper_version_template_check" CHECK (("exam_question_paper_version"."paper_print_layout"::text = 'plain') = ("exam_question_paper_version"."template_revision_id" is null));--> statement-breakpoint
ALTER TABLE "exam_question_paper_version" ADD COLUMN "printed_details" jsonb;--> statement-breakpoint
ALTER TABLE "exam_question_paper_version" ADD CONSTRAINT "exam_question_paper_version_printed_details_check" CHECK (("exam_question_paper_version"."printed_details" is not null) = ("exam_question_paper_version"."paper_kind"::text = 'standalone' and "exam_question_paper_version"."paper_print_layout"::text = 'school_template'));
