CREATE TABLE "admission" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"name" varchar NOT NULL,
	"admission_no" varchar NOT NULL,
	"admission_class_id" text,
	"address" varchar NOT NULL,
	"phone_no" varchar NOT NULL,
	"email" varchar,
	"dob" date NOT NULL,
	"father_name" varchar NOT NULL,
	"mother_name" varchar NOT NULL,
	"registered" boolean DEFAULT true NOT NULL,
	"photo_s3_key" varchar,
	"documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"finance_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "student" (
	"id" text PRIMARY KEY NOT NULL,
	"class_id" text,
	"section_id" text,
	"school_id" text NOT NULL,
	"admission_id" text NOT NULL,
	"session_id" text NOT NULL,
	"roll_no" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "student_unique_session" UNIQUE("admission_id","session_id"),
	CONSTRAINT "student_unique_rollno_per_section" UNIQUE("session_id","class_id","section_id","roll_no")
);
--> statement-breakpoint
ALTER TABLE "school" ADD COLUMN "admission_settings" jsonb DEFAULT '{"documentTypes":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "admission" ADD CONSTRAINT "admission_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission" ADD CONSTRAINT "admission_admission_class_id_class_id_fk" FOREIGN KEY ("admission_class_id") REFERENCES "public"."class"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_section_id_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."section"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_admission_id_admission_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."admission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_session_id_school_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."school_session"("id") ON DELETE no action ON UPDATE no action;