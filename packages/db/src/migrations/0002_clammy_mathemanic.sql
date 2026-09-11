CREATE TABLE "school" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" varchar NOT NULL,
	"name" varchar NOT NULL,
	"location" varchar NOT NULL,
	"registration_no" varchar,
	"logo_s3_key" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"has_completed_onboarding" boolean DEFAULT false NOT NULL,
	CONSTRAINT "school_slug_unique" UNIQUE("slug")
);
