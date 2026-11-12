-- A question paper version stores the HTML fragment a model wrote instead of
-- the structured JSON document (docs/question-papers.md). The computed marks
-- go with the JSON: nothing adds up a paper's marks any more. `plan_max_marks`
-- stays: it is the header snapshot of the plan, not a computed total.
-- `warnings` stays and now holds sanitiser notices ({ code, message }), so every
-- old entry ({ code, path, message } about marks) is reset.
--
-- The JSON model was never released, so no version can be converted. Any row
-- that exists (a development database) keeps its PDF and gets a one-line
-- placeholder fragment and one `legacy` notice (so the version list, the card
-- and the preview say the preview is not available and the PDF is the original);
-- generating the paper again replaces it with a new version.
ALTER TABLE "exam_question_paper_version" ADD COLUMN "content_html" text;--> statement-breakpoint
UPDATE "exam_question_paper_version" SET "content_html" = '<p>This version was saved in an earlier format that can no longer be shown. Generate the paper again.</p>', "warnings" = '[{"code":"legacy","message":"Saved in an earlier format. The preview is not available; the PDF is the original."}]'::jsonb;--> statement-breakpoint
ALTER TABLE "exam_question_paper_version" ALTER COLUMN "content_html" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_question_paper_version" DROP COLUMN "content";--> statement-breakpoint
ALTER TABLE "exam_question_paper_version" DROP COLUMN "schema_version";--> statement-breakpoint
ALTER TABLE "exam_question_paper_version" DROP COLUMN "total_marks";
