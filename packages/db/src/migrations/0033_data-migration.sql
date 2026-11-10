CREATE TYPE "public"."data_migration_run_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "data_migration_run" (
	"id" text PRIMARY KEY NOT NULL,
	"migration_id" text NOT NULL,
	"dry_run" boolean NOT NULL,
	"status" "data_migration_run_status" DEFAULT 'pending' NOT NULL,
	"requested_by" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"submit_invocation_id" text,
	"submit_attempts" integer DEFAULT 0 NOT NULL,
	"last_submit_error" text,
	"invocation_id" text,
	"checkpoint" text,
	"batch_count" integer DEFAULT 0 NOT NULL,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"changed_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_migration_skipped_item" (
	"run_id" text NOT NULL,
	"item_key" text NOT NULL,
	"reason" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_migration_skipped_item_run_id_item_key_pk" PRIMARY KEY("run_id","item_key")
);
--> statement-breakpoint
ALTER TABLE "data_migration_run" ADD CONSTRAINT "data_migration_run_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_migration_skipped_item" ADD CONSTRAINT "data_migration_skipped_item_run_id_data_migration_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."data_migration_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "data_migration_run_active_unique" ON "data_migration_run" USING btree ("migration_id") WHERE "data_migration_run"."status" in ('pending', 'running');--> statement-breakpoint
CREATE INDEX "data_migration_run_migration_idx" ON "data_migration_run" USING btree ("migration_id","requested_at");--> statement-breakpoint
CREATE INDEX "data_migration_run_status_idx" ON "data_migration_run" USING btree ("status","requested_at");