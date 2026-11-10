CREATE TYPE "public"."assistant_approval_status" AS ENUM('pending', 'approved', 'declined', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."assistant_item_kind" AS ENUM('user_message', 'assistant_message', 'tool_call', 'view');--> statement-breakpoint
CREATE TYPE "public"."assistant_item_status" AS ENUM('streaming', 'complete', 'awaiting_approval', 'running', 'succeeded', 'failed', 'declined', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."assistant_model_provider" AS ENUM('anthropic', 'gemini');--> statement-breakpoint
CREATE TYPE "public"."assistant_run_status" AS ENUM('queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."assistant_surface" AS ENUM('panel', 'page', 'palette');--> statement-breakpoint
CREATE TYPE "public"."assistant_transcript_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TABLE "assistant_approval" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"run_id" text NOT NULL,
	"item_id" text NOT NULL,
	"school_id" text NOT NULL,
	"user_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"status" "assistant_approval_status" DEFAULT 'pending' NOT NULL,
	"awakeable_id" text NOT NULL,
	"decided_at" timestamp with time zone,
	"resolution_handed_over_at" timestamp with time zone,
	"resolution_handover_attempts" integer DEFAULT 0 NOT NULL,
	"last_resolution_handover_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_approval_item_id_unique" UNIQUE("item_id")
);
--> statement-breakpoint
CREATE TABLE "assistant_conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"provider" "assistant_model_provider" NOT NULL,
	"model" text NOT NULL,
	"last_sequence" integer DEFAULT 0 NOT NULL,
	"last_position" integer DEFAULT 0 NOT NULL,
	"last_transcript_position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_item" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"run_id" text NOT NULL,
	"kind" "assistant_item_kind" NOT NULL,
	"status" "assistant_item_status" NOT NULL,
	"position" integer NOT NULL,
	"sequence" integer NOT NULL,
	"body" jsonb NOT NULL,
	"item_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_item_conversation_position_unique" UNIQUE("conversation_id","position"),
	CONSTRAINT "assistant_item_conversation_key_unique" UNIQUE("conversation_id","item_key")
);
--> statement-breakpoint
CREATE TABLE "assistant_model_request" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text,
	"school_id" text NOT NULL,
	"user_id" text NOT NULL,
	"request_key" text NOT NULL,
	"usage_complete" boolean NOT NULL,
	"provider" "assistant_model_provider" NOT NULL,
	"requested_model" text NOT NULL,
	"answered_model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_read_input_tokens" integer NOT NULL,
	"cache_creation_input_tokens" integer NOT NULL,
	"input_usd_per_mtok" numeric(14, 6) NOT NULL,
	"output_usd_per_mtok" numeric(14, 6) NOT NULL,
	"cache_read_usd_per_mtok" numeric(14, 6) NOT NULL,
	"cache_write_usd_per_mtok" numeric(14, 6) NOT NULL,
	"cost_usd" numeric(14, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_model_request_request_key_unique" UNIQUE("request_key")
);
--> statement-breakpoint
CREATE TABLE "assistant_run" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"school_id" text NOT NULL,
	"user_id" text NOT NULL,
	"client_request_id" text NOT NULL,
	"surface" "assistant_surface" NOT NULL,
	"status" "assistant_run_status" DEFAULT 'queued' NOT NULL,
	"provider" "assistant_model_provider",
	"model" text,
	"stop_requested_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"error_detail" text,
	"model_request_count" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_creation_input_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(14, 8) DEFAULT '0' NOT NULL,
	"sequence" integer NOT NULL,
	"handed_over_at" timestamp with time zone,
	"handover_attempts" integer DEFAULT 0 NOT NULL,
	"last_handover_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "assistant_run_user_client_request_unique" UNIQUE("user_id","client_request_id")
);
--> statement-breakpoint
CREATE TABLE "assistant_transcript_entry" (
	"conversation_id" text NOT NULL,
	"position" integer NOT NULL,
	"run_id" text NOT NULL,
	"role" "assistant_transcript_role" NOT NULL,
	"content" jsonb NOT NULL,
	"entry_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_transcript_entry_conversation_id_position_pk" PRIMARY KEY("conversation_id","position"),
	CONSTRAINT "assistant_transcript_entry_key_unique" UNIQUE("conversation_id","entry_key")
);
--> statement-breakpoint
CREATE TABLE "school_assistant_access_role" (
	"school_id" text NOT NULL,
	"role" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_assistant_access_role_school_id_role_pk" PRIMARY KEY("school_id","role")
);
--> statement-breakpoint
ALTER TABLE "assistant_approval" ADD CONSTRAINT "assistant_approval_conversation_id_assistant_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_approval" ADD CONSTRAINT "assistant_approval_run_id_assistant_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."assistant_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_approval" ADD CONSTRAINT "assistant_approval_item_id_assistant_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."assistant_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_approval" ADD CONSTRAINT "assistant_approval_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD CONSTRAINT "assistant_conversation_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_item" ADD CONSTRAINT "assistant_item_conversation_id_assistant_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_item" ADD CONSTRAINT "assistant_item_run_id_assistant_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."assistant_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_model_request" ADD CONSTRAINT "assistant_model_request_run_id_assistant_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."assistant_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_model_request" ADD CONSTRAINT "assistant_model_request_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_run" ADD CONSTRAINT "assistant_run_conversation_id_assistant_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_run" ADD CONSTRAINT "assistant_run_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_transcript_entry" ADD CONSTRAINT "assistant_transcript_entry_conversation_id_assistant_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_transcript_entry" ADD CONSTRAINT "assistant_transcript_entry_run_id_assistant_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."assistant_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_assistant_access_role" ADD CONSTRAINT "school_assistant_access_role_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_assistant_access_role" ADD CONSTRAINT "school_assistant_access_role_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_approval_run_idx" ON "assistant_approval" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "assistant_conversation_school_user_updated_idx" ON "assistant_conversation" USING btree ("school_id","user_id","updated_at");--> statement-breakpoint
CREATE INDEX "assistant_item_conversation_sequence_idx" ON "assistant_item" USING btree ("conversation_id","sequence");--> statement-breakpoint
CREATE INDEX "assistant_item_run_idx" ON "assistant_item" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "assistant_model_request_school_created_idx" ON "assistant_model_request" USING btree ("school_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_model_request_created_idx" ON "assistant_model_request" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "assistant_model_request_run_idx" ON "assistant_model_request" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "assistant_run_conversation_idx" ON "assistant_run" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_run_school_created_idx" ON "assistant_run" USING btree ("school_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_transcript_entry_run_idx" ON "assistant_transcript_entry" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "school_assistant_access_role_updated_by_idx" ON "school_assistant_access_role" USING btree ("updated_by");