CREATE TYPE "public"."document_template_page_size" AS ENUM('full', 'half');--> statement-breakpoint
ALTER TABLE "artifact" ADD COLUMN "page_size" "document_template_page_size" DEFAULT 'full' NOT NULL;