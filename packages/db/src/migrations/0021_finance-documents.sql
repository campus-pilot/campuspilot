ALTER TYPE "public"."document_type" ADD VALUE IF NOT EXISTS 'bill';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE IF NOT EXISTS 'receipt';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE IF NOT EXISTS 'statement';--> statement-breakpoint
ALTER TABLE "artifact" ADD COLUMN "finance_source" jsonb;--> statement-breakpoint
ALTER TABLE "finance_payment" ADD COLUMN "document_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "finance_ledger_entry" ADD COLUMN "document_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_finance_source_shape_check" CHECK (
  ("kind"::text = 'template' AND "finance_source" IS NULL)
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
);--> statement-breakpoint
ALTER TABLE "finance_payment" ADD CONSTRAINT "finance_payment_document_snapshot_shape_check" CHECK (
  "document_snapshot" IS NULL OR (
    jsonb_typeof("document_snapshot") = 'object'
    AND "document_snapshot" ?& ARRAY['admissionNumber','admissionName','fatherName','motherName','sessionStartYear','sessionEndYear','enrollmentId','classId','classLabel','sectionId','sectionLabel','rollNumber']
    AND "document_snapshot" - ARRAY['admissionNumber','admissionName','fatherName','motherName','sessionStartYear','sessionEndYear','enrollmentId','classId','classLabel','sectionId','sectionLabel','rollNumber'] = '{}'::jsonb
    AND nullif(btrim("document_snapshot" ->> 'admissionNumber'), '') IS NOT NULL
    AND nullif(btrim("document_snapshot" ->> 'admissionName'), '') IS NOT NULL
    AND jsonb_typeof("document_snapshot" -> 'fatherName') = 'string'
    AND jsonb_typeof("document_snapshot" -> 'motherName') = 'string'
    AND jsonb_typeof("document_snapshot" -> 'sessionStartYear') = 'number'
    AND jsonb_typeof("document_snapshot" -> 'sessionEndYear') = 'number'
    AND jsonb_typeof("document_snapshot" -> 'enrollmentId') IN ('string', 'null')
    AND jsonb_typeof("document_snapshot" -> 'classId') IN ('string', 'null')
    AND jsonb_typeof("document_snapshot" -> 'classLabel') IN ('string', 'null')
    AND jsonb_typeof("document_snapshot" -> 'sectionId') IN ('string', 'null')
    AND jsonb_typeof("document_snapshot" -> 'sectionLabel') IN ('string', 'null')
    AND jsonb_typeof("document_snapshot" -> 'rollNumber') IN ('number', 'null')
  )
);--> statement-breakpoint
ALTER TABLE "finance_ledger_entry" ADD CONSTRAINT "finance_ledger_document_snapshot_shape_check" CHECK (
  "document_snapshot" IS NULL OR (
    jsonb_typeof("document_snapshot") = 'object'
    AND "document_snapshot" ?& ARRAY['admissionNumber','admissionName','fatherName','motherName','sessionStartYear','sessionEndYear','enrollmentId','classId','classLabel','sectionId','sectionLabel','rollNumber']
    AND "document_snapshot" - ARRAY['admissionNumber','admissionName','fatherName','motherName','sessionStartYear','sessionEndYear','enrollmentId','classId','classLabel','sectionId','sectionLabel','rollNumber'] = '{}'::jsonb
    AND nullif(btrim("document_snapshot" ->> 'admissionNumber'), '') IS NOT NULL
    AND nullif(btrim("document_snapshot" ->> 'admissionName'), '') IS NOT NULL
    AND jsonb_typeof("document_snapshot" -> 'sessionStartYear') = 'number'
    AND jsonb_typeof("document_snapshot" -> 'sessionEndYear') = 'number'
  )
);--> statement-breakpoint
CREATE INDEX "artifact_finance_admission_ids_gin_idx" ON "artifact" USING gin (("finance_source" -> 'admissionIds'));--> statement-breakpoint
CREATE INDEX "artifact_finance_source_kind_idx" ON "artifact" (("finance_source" ->> 'kind')) WHERE "finance_source" IS NOT NULL;
