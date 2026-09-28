ALTER TABLE "class" ADD COLUMN "display_order" integer;--> statement-breakpoint
WITH "ordered_classes" AS (
	SELECT "id", row_number() OVER (PARTITION BY "school_id" ORDER BY "created_at", "id")::integer AS "display_order"
	FROM "class"
)
UPDATE "class"
SET "display_order" = "ordered_classes"."display_order"
FROM "ordered_classes"
WHERE "class"."id" = "ordered_classes"."id";--> statement-breakpoint
ALTER TABLE "class" ALTER COLUMN "display_order" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "section" ADD COLUMN "display_order" integer;--> statement-breakpoint
WITH "ordered_sections" AS (
	SELECT "id", row_number() OVER (PARTITION BY "class_id" ORDER BY "created_at", "id")::integer AS "display_order"
	FROM "section"
)
UPDATE "section"
SET "display_order" = "ordered_sections"."display_order"
FROM "ordered_sections"
WHERE "section"."id" = "ordered_sections"."id";--> statement-breakpoint
ALTER TABLE "section" ALTER COLUMN "display_order" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "class" ADD CONSTRAINT "class_school_id_display_order_unique" UNIQUE("school_id","display_order");--> statement-breakpoint
ALTER TABLE "section" ADD CONSTRAINT "section_class_id_display_order_unique" UNIQUE("class_id","display_order");
