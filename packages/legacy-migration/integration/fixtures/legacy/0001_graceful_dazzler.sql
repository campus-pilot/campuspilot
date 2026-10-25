CREATE TABLE "ai_quota" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"usage_type" varchar NOT NULL,
	"monthly_limit" integer DEFAULT 50 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "ai_quota_school_type_unique" UNIQUE("school_id","usage_type")
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"usage_type" varchar NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "ai_usage_school_type_month_unique" UNIQUE("school_id","usage_type","year","month")
);
--> statement-breakpoint
ALTER TABLE "school" ADD COLUMN "features" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "ai_quota" ADD CONSTRAINT "ai_quota_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;