-- Bill due (docs/document-system.md "Bill due"): a bill for one admission as
-- of a chosen date. It is its own document type in history, generation jobs
-- and permissions, and is printed with the school's selected `bill` template,
-- so no `school_document_template` row ever uses it. No new table or object
-- prefix: its PDFs are ordinary `artifact` rows and job objects under the
-- school's prefix, already covered by purge_demo_school and the demo purge
-- workflow.
ALTER TYPE "public"."document_type" ADD VALUE IF NOT EXISTS 'bill_due';
