CREATE TABLE "class" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" varchar NOT NULL,
	"label" varchar NOT NULL,
	"school_id" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{"subjects":{}}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "class_slug_unique" UNIQUE("school_id","slug")
);
--> statement-breakpoint
CREATE TABLE "section" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" varchar NOT NULL,
	"label" varchar NOT NULL,
	"class_id" text NOT NULL,
	"school_id" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "section_slug_unique" UNIQUE("class_id","slug")
);
--> statement-breakpoint
ALTER TABLE "school_session" ADD COLUMN "finance_class_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "class" ADD CONSTRAINT "class_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section" ADD CONSTRAINT "section_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section" ADD CONSTRAINT "section_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;