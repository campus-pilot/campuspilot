CREATE TYPE "public"."assistant_attachment_kind" AS ENUM('image', 'document');--> statement-breakpoint
ALTER TABLE "assistant_attachment" DROP CONSTRAINT "assistant_attachment_derivative_check";--> statement-breakpoint
ALTER TABLE "assistant_attachment" ALTER COLUMN "derivative_status" DROP NOT NULL;--> statement-breakpoint
-- Every attachment before this migration is an image: the default fills the existing rows once and is
-- dropped at once, so a new row always states its kind (as 0060 did for assistant_model_request.source).
ALTER TABLE "assistant_attachment" ADD COLUMN "kind" "assistant_attachment_kind" NOT NULL DEFAULT 'image';--> statement-breakpoint
ALTER TABLE "assistant_attachment" ALTER COLUMN "kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "assistant_attachment" ADD CONSTRAINT "assistant_attachment_kind_check" CHECK (("assistant_attachment"."kind" = 'image') = ("assistant_attachment"."derivative_status" is not null) and ("assistant_attachment"."kind" = 'image' or ("assistant_attachment"."width" is null and "assistant_attachment"."height" is null and "assistant_attachment"."thumb_s3_key" is null and "assistant_attachment"."model_s3_key" is null and "assistant_attachment"."model_content_type" is null and "assistant_attachment"."model_byte_size" is null and "assistant_attachment"."content_type" = 'application/pdf')));--> statement-breakpoint
ALTER TABLE "assistant_attachment" ADD CONSTRAINT "assistant_attachment_derivative_check" CHECK (coalesce("assistant_attachment"."derivative_status" = 'ready', false) = ("assistant_attachment"."thumb_s3_key" is not null and "assistant_attachment"."model_s3_key" is not null));--> statement-breakpoint
-- The kind is also an explicit field of every stored attachment reference (a user message body) and of every
-- transcript marker. Those written before this migration were all images; they get kind "image" here, so no
-- reader ever has to guess a missing kind. Element order is kept.
UPDATE "assistant_item" SET "body" = jsonb_set("body", '{attachments}', (
	SELECT jsonb_agg(CASE WHEN "ref" ? 'kind' THEN "ref" ELSE "ref" || '{"kind":"image"}'::jsonb END ORDER BY "position")
	FROM jsonb_array_elements("body" -> 'attachments') WITH ORDINALITY AS "refs"("ref", "position")
)) WHERE "kind" = 'user_message' AND jsonb_typeof("body" -> 'attachments') = 'array' AND jsonb_array_length("body" -> 'attachments') > 0;--> statement-breakpoint
UPDATE "assistant_transcript_entry" SET "content" = (
	SELECT jsonb_agg(CASE WHEN "block" ->> 'type' = 'campuspilot_attachment' AND NOT "block" ? 'kind' THEN "block" || '{"kind":"image"}'::jsonb ELSE "block" END ORDER BY "position")
	FROM jsonb_array_elements("content") WITH ORDINALITY AS "blocks"("block", "position")
) WHERE "content" @> '[{"type":"campuspilot_attachment"}]'::jsonb;