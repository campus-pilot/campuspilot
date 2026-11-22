ALTER TYPE "public"."artifact_kind" ADD VALUE IF NOT EXISTS 'docx';--> statement-breakpoint
ALTER TABLE "exam_question_paper_version" ADD COLUMN "docx_artifact_id" text;--> statement-breakpoint
ALTER TABLE "exam_question_paper_version" ADD CONSTRAINT "exam_question_paper_version_docx_artifact_id_artifact_id_fk" FOREIGN KEY ("docx_artifact_id") REFERENCES "public"."artifact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exam_question_paper_version_docx_idx" ON "exam_question_paper_version" USING btree ("docx_artifact_id");--> statement-breakpoint
-- The artifact shape check (0021) names every kind it accepts, so a Word file of a question paper version must be
-- added to it: kind docx, only for question papers, never with a finance source. Compared as text, so the new enum
-- value is not used before this transaction commits. The other branches are 0021's, unchanged.
ALTER TABLE "artifact" DROP CONSTRAINT "artifact_finance_source_shape_check";--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_finance_source_shape_check" CHECK (
  ("kind"::text = 'template' AND "finance_source" IS NULL)
  OR ("kind"::text = 'docx' AND "document_type"::text = 'question_paper' AND "finance_source" IS NULL)
  OR ("kind"::text = 'pdf' AND "document_type"::text NOT IN ('bill', 'receipt', 'statement') AND "finance_source" IS NULL)
  OR ("kind"::text = 'pdf' AND "document_type"::text = 'bill'
    AND "session_id" IS NOT NULL AND "template_revision_id" IS NOT NULL
    AND "student_count" = 0 AND "student_ids" = '[]'::jsonb
    AND jsonb_typeof("finance_source") = 'object'
    AND "finance_source" ?& ARRAY['kind','admissionIds','billIds','billRunId']
    AND "finance_source" - ARRAY['kind','admissionIds','billIds','billRunId'] = '{}'::jsonb
    AND "finance_source" ->> 'kind' = 'bill'
    AND jsonb_typeof("finance_source" -> 'admissionIds') = 'array'
    AND jsonb_array_length("finance_source" -> 'admissionIds') > 0
    AND jsonb_array_length(jsonb_path_query_array("finance_source", '$.admissionIds[*] ? (@.type() == "string")')) = jsonb_array_length("finance_source" -> 'admissionIds')
    AND jsonb_typeof("finance_source" -> 'billIds') = 'array'
    AND jsonb_array_length("finance_source" -> 'billIds') > 0
    AND jsonb_array_length(jsonb_path_query_array("finance_source", '$.billIds[*] ? (@.type() == "string")')) = jsonb_array_length("finance_source" -> 'billIds')
    AND jsonb_typeof("finance_source" -> 'billRunId') IN ('string', 'null'))
  OR ("kind"::text = 'pdf' AND "document_type"::text = 'receipt'
    AND "session_id" IS NOT NULL AND "template_revision_id" IS NOT NULL
    AND "student_count" = 0 AND "student_ids" = '[]'::jsonb
    AND jsonb_typeof("finance_source") = 'object'
    AND "finance_source" ?& ARRAY['kind','admissionIds','transactions']
    AND "finance_source" - ARRAY['kind','admissionIds','transactions'] = '{}'::jsonb
    AND "finance_source" ->> 'kind' = 'receipt'
    AND jsonb_typeof("finance_source" -> 'admissionIds') = 'array'
    AND jsonb_array_length("finance_source" -> 'admissionIds') > 0
    AND jsonb_array_length(jsonb_path_query_array("finance_source", '$.admissionIds[*] ? (@.type() == "string")')) = jsonb_array_length("finance_source" -> 'admissionIds')
    AND jsonb_typeof("finance_source" -> 'transactions') = 'array'
    AND jsonb_array_length("finance_source" -> 'transactions') > 0
    AND jsonb_array_length(jsonb_path_query_array("finance_source", '$.transactions[*] ? ((@.kind == "payment" || @.kind == "refund") && @.id.type() == "string")')) = jsonb_array_length("finance_source" -> 'transactions'))
  OR ("kind"::text = 'pdf' AND "document_type"::text = 'statement'
    AND "session_id" IS NOT NULL AND "template_revision_id" IS NOT NULL
    AND "student_count" = 0 AND "student_ids" = '[]'::jsonb
    AND jsonb_typeof("finance_source") = 'object'
    AND "finance_source" ?& ARRAY['kind','currency','throughDate','timeZone','accounts']
    AND "finance_source" - ARRAY['kind','currency','throughDate','timeZone','accounts'] = '{}'::jsonb
    AND "finance_source" ->> 'kind' = 'statement'
    AND nullif(btrim("finance_source" ->> 'currency'), '') IS NOT NULL
    AND ("finance_source" ->> 'throughDate') ~ '^\d{4}-\d{2}-\d{2}$'
    AND nullif(btrim("finance_source" ->> 'timeZone'), '') IS NOT NULL
    AND jsonb_typeof("finance_source" -> 'accounts') = 'array'
    AND jsonb_array_length("finance_source" -> 'accounts') > 0
    AND jsonb_array_length(jsonb_path_query_array("finance_source", '$.accounts[*] ? (@.admissionId.type() == "string" && @.highWaterSequence.type() == "string")')) = jsonb_array_length("finance_source" -> 'accounts'))
);
