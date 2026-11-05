-- The migrator creates this schema first, to hold its journal table.
CREATE SCHEMA IF NOT EXISTS "assistant";
--> statement-breakpoint
CREATE TYPE "assistant"."assistant_approval_status" AS ENUM('pending', 'approved', 'declined', 'cancelled');--> statement-breakpoint
CREATE TYPE "assistant"."assistant_item_kind" AS ENUM('user_message', 'assistant_message', 'tool_call');--> statement-breakpoint
CREATE TYPE "assistant"."assistant_item_status" AS ENUM('streaming', 'complete', 'awaiting_approval', 'running', 'succeeded', 'failed', 'declined', 'cancelled');--> statement-breakpoint
CREATE TYPE "assistant"."assistant_run_status" AS ENUM('queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "assistant"."assistant_surface" AS ENUM('panel', 'page', 'palette');--> statement-breakpoint
CREATE TYPE "assistant"."assistant_transcript_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TABLE "assistant"."assistant_approval" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"run_id" text NOT NULL,
	"item_id" text NOT NULL,
	"school_id" text NOT NULL,
	"user_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"status" "assistant"."assistant_approval_status" DEFAULT 'pending' NOT NULL,
	"awakeable_id" text NOT NULL,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_approval_item_id_unique" UNIQUE("item_id")
);
--> statement-breakpoint
CREATE TABLE "assistant"."assistant_conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"last_sequence" integer DEFAULT 0 NOT NULL,
	"last_position" integer DEFAULT 0 NOT NULL,
	"last_transcript_position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant"."assistant_item" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"run_id" text NOT NULL,
	"kind" "assistant"."assistant_item_kind" NOT NULL,
	"status" "assistant"."assistant_item_status" NOT NULL,
	"position" integer NOT NULL,
	"sequence" integer NOT NULL,
	"body" jsonb NOT NULL,
	"item_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_item_conversation_position_unique" UNIQUE("conversation_id","position"),
	CONSTRAINT "assistant_item_conversation_key_unique" UNIQUE("conversation_id","item_key")
);
--> statement-breakpoint
CREATE TABLE "assistant"."assistant_run" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"school_id" text NOT NULL,
	"user_id" text NOT NULL,
	"client_request_id" text NOT NULL,
	"surface" "assistant"."assistant_surface" NOT NULL,
	"status" "assistant"."assistant_run_status" DEFAULT 'queued' NOT NULL,
	"model" text,
	"stop_requested_at" timestamp,
	"error_code" text,
	"error_message" text,
	"model_request_count" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_creation_input_tokens" integer DEFAULT 0 NOT NULL,
	"sequence" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	CONSTRAINT "assistant_run_user_client_request_unique" UNIQUE("user_id","client_request_id")
);
--> statement-breakpoint
CREATE TABLE "assistant"."assistant_transcript_entry" (
	"conversation_id" text NOT NULL,
	"position" integer NOT NULL,
	"run_id" text NOT NULL,
	"role" "assistant"."assistant_transcript_role" NOT NULL,
	"content" jsonb NOT NULL,
	"entry_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_transcript_entry_conversation_id_position_pk" PRIMARY KEY("conversation_id","position"),
	CONSTRAINT "assistant_transcript_entry_key_unique" UNIQUE("conversation_id","entry_key")
);
--> statement-breakpoint
ALTER TABLE "assistant"."assistant_approval" ADD CONSTRAINT "assistant_approval_conversation_id_assistant_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "assistant"."assistant_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant"."assistant_approval" ADD CONSTRAINT "assistant_approval_run_id_assistant_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "assistant"."assistant_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant"."assistant_approval" ADD CONSTRAINT "assistant_approval_item_id_assistant_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "assistant"."assistant_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant"."assistant_item" ADD CONSTRAINT "assistant_item_conversation_id_assistant_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "assistant"."assistant_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant"."assistant_item" ADD CONSTRAINT "assistant_item_run_id_assistant_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "assistant"."assistant_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant"."assistant_run" ADD CONSTRAINT "assistant_run_conversation_id_assistant_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "assistant"."assistant_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant"."assistant_transcript_entry" ADD CONSTRAINT "assistant_transcript_entry_conversation_id_assistant_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "assistant"."assistant_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant"."assistant_transcript_entry" ADD CONSTRAINT "assistant_transcript_entry_run_id_assistant_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "assistant"."assistant_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_approval_run_idx" ON "assistant"."assistant_approval" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "assistant_conversation_school_user_updated_idx" ON "assistant"."assistant_conversation" USING btree ("school_id","user_id","updated_at");--> statement-breakpoint
CREATE INDEX "assistant_item_conversation_sequence_idx" ON "assistant"."assistant_item" USING btree ("conversation_id","sequence");--> statement-breakpoint
CREATE INDEX "assistant_run_conversation_idx" ON "assistant"."assistant_run" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_run_school_created_idx" ON "assistant"."assistant_run" USING btree ("school_id","created_at");