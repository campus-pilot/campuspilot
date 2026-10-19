ALTER TABLE "finance_admission_balance" ALTER COLUMN "debit_total_minor" SET DATA TYPE numeric(38, 0);--> statement-breakpoint
ALTER TABLE "finance_admission_balance" ALTER COLUMN "credit_total_minor" SET DATA TYPE numeric(38, 0);--> statement-breakpoint
ALTER TABLE "finance_admission_session_activity" ALTER COLUMN "debit_total_minor" SET DATA TYPE numeric(38, 0);--> statement-breakpoint
ALTER TABLE "finance_admission_session_activity" ALTER COLUMN "credit_total_minor" SET DATA TYPE numeric(38, 0);--> statement-breakpoint
CREATE INDEX "student_school_session_admission_id_idx" ON "student" USING btree ("school_id","session_id","admission_id","id");--> statement-breakpoint
CREATE INDEX "student_school_session_class_admission_id_idx" ON "student" USING btree ("school_id","session_id","class_id","admission_id","id");