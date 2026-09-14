ALTER TABLE "school_session" ADD COLUMN "is_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "school_session_school_id_idx" ON "school_session" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "school_session_one_active_per_school_idx" ON "school_session" USING btree ("school_id") WHERE "school_session"."is_active" = true;