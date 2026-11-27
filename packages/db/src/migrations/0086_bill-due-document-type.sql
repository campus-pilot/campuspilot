-- Bill due (docs/document-system.md "Bill due"): a bill for one admission as
-- of a chosen date. It is its own document type in history, generation jobs
-- and permissions, and is printed with the school's selected `bill` template,
-- so no `school_document_template` row ever uses it. Its PDFs are ordinary
-- `artifact` rows and its job objects live under the school's prefix, both
-- already covered by purge_demo_school and the demo purge workflow.
ALTER TYPE "public"."document_type" ADD VALUE IF NOT EXISTS 'bill_due';--> statement-breakpoint
-- The artifact shape check (0021, last rewritten in 0081) names every finance
-- type and requires a NULL finance source for every other type, so a Bill due
-- PDF must be added to it: its finance source is the reviewed period and
-- accounts (`highWaterSequence` is null for an account with no ledger fact
-- through the date). Compared as text, so the new enum value is not used before
-- this transaction commits. The other branches are 0081's, unchanged.
ALTER TABLE "artifact" DROP CONSTRAINT "artifact_finance_source_shape_check";--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_finance_source_shape_check" CHECK (
  ("kind"::text = 'template' AND "finance_source" IS NULL)
  OR ("kind"::text = 'docx' AND "document_type"::text = 'question_paper' AND "finance_source" IS NULL)
  OR ("kind"::text = 'pdf' AND "document_type"::text NOT IN ('bill', 'receipt', 'statement', 'bill_due') AND "finance_source" IS NULL)
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
  OR ("kind"::text = 'pdf' AND "document_type"::text = 'bill_due'
    AND "session_id" IS NOT NULL AND "template_revision_id" IS NOT NULL
    AND "student_count" = 0 AND "student_ids" = '[]'::jsonb
    AND jsonb_typeof("finance_source") = 'object'
    AND "finance_source" ?& ARRAY['kind','currency','throughDate','timeZone','period','accounts']
    AND "finance_source" - ARRAY['kind','currency','throughDate','timeZone','period','accounts'] = '{}'::jsonb
    AND "finance_source" ->> 'kind' = 'bill_due'
    AND nullif(btrim("finance_source" ->> 'currency'), '') IS NOT NULL
    AND ("finance_source" ->> 'throughDate') ~ '^\d{4}-\d{2}-\d{2}$'
    AND nullif(btrim("finance_source" ->> 'timeZone'), '') IS NOT NULL
    AND jsonb_typeof("finance_source" -> 'period') = 'object'
    AND ("finance_source" -> 'period') ?& ARRAY['cadence','startDate','endDate']
    AND ("finance_source" -> 'period') - ARRAY['cadence','startDate','endDate'] = '{}'::jsonb
    AND "finance_source" #>> '{period,cadence}' IN ('monthly', 'quarterly', 'yearly')
    AND ("finance_source" #>> '{period,startDate}') ~ '^\d{4}-\d{2}-\d{2}$'
    AND ("finance_source" #>> '{period,endDate}') ~ '^\d{4}-\d{2}-\d{2}$'
    AND jsonb_typeof("finance_source" -> 'accounts') = 'array'
    AND jsonb_array_length("finance_source" -> 'accounts') > 0
    AND jsonb_array_length(jsonb_path_query_array("finance_source", '$.accounts[*] ? (@.admissionId.type() == "string" && (@.highWaterSequence.type() == "string" || @.highWaterSequence.type() == "null"))')) = jsonb_array_length("finance_source" -> 'accounts'))
);
