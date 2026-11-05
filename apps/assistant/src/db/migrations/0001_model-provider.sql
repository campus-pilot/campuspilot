-- Conversations from the single-provider build must not be backfilled with a
-- guessed model, so this fails on a database that has them; the swappable
-- build runs on its own assistant database.
CREATE TYPE "assistant"."assistant_model_provider" AS ENUM('anthropic', 'gemini');--> statement-breakpoint
ALTER TABLE "assistant"."assistant_conversation" ADD COLUMN "provider" "assistant"."assistant_model_provider" NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant"."assistant_conversation" ADD COLUMN "model" text NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant"."assistant_run" ADD COLUMN "provider" "assistant"."assistant_model_provider";