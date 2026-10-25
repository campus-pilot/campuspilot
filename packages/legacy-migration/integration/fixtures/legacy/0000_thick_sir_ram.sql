CREATE TYPE "public"."bill_generation_event_type" AS ENUM('NEW');--> statement-breakpoint
CREATE TYPE "public"."exam_plan_status" AS ENUM('draft', 'approved', 'active', 'completed');--> statement-breakpoint
CREATE TYPE "public"."ledger_event_type" AS ENUM('PAYMENT');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('admin', 'manager', 'accountant', 'exam_coordinator', 'teacher');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admission" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"name" varchar NOT NULL,
	"admissionNo" varchar NOT NULL,
	"admission_class_id" text,
	"address" varchar NOT NULL,
	"phoneNo" varchar NOT NULL,
	"email" varchar,
	"dob" timestamp NOT NULL,
	"fatherName" varchar NOT NULL,
	"motherName" varchar NOT NULL,
	"registered" boolean DEFAULT true NOT NULL,
	"photo_s3_key" varchar,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"reference_id" text NOT NULL,
	"prefix" text,
	"key" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 86400000,
	"rate_limit_max" integer DEFAULT 10,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "artifact" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"entity_type" varchar NOT NULL,
	"entity_id" text NOT NULL,
	"type" varchar NOT NULL,
	"scope" varchar,
	"s3_key" varchar NOT NULL,
	"content_type" varchar NOT NULL,
	"status" varchar DEFAULT 'current' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now(),
	CONSTRAINT "artifact_lookup_idx" UNIQUE("school_id","entity_type","entity_id","type","scope")
);
--> statement-breakpoint
CREATE TABLE "bill_generation_event" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"session_id" text NOT NULL,
	"type" "bill_generation_event_type" NOT NULL,
	"generated_by" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "class" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" varchar NOT NULL,
	"label" varchar NOT NULL,
	"school_id" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb,
	"config" jsonb DEFAULT '{}'::jsonb,
	"finance_config" jsonb,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now(),
	CONSTRAINT "class_slug_unique" UNIQUE("school_id","slug")
);
--> statement-breakpoint
CREATE TABLE "exam_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"session_id" text NOT NULL,
	"examSlug" varchar NOT NULL,
	"class_id" text NOT NULL,
	"subjectSlug" varchar NOT NULL,
	"totalMarks" integer DEFAULT 100 NOT NULL,
	"modeConfig" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"totalWorkingDays" integer,
	"status" "exam_plan_status" DEFAULT 'draft' NOT NULL,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now(),
	CONSTRAINT "exam_plan_unique" UNIQUE("session_id","examSlug","class_id","subjectSlug")
);
--> statement-breakpoint
CREATE TABLE "exam_result" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_plan_id" text NOT NULL,
	"student_id" text NOT NULL,
	"school_id" text NOT NULL,
	"session_id" text NOT NULL,
	"marks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"coScholastics" jsonb,
	"days_attended" integer,
	"approved" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now(),
	CONSTRAINT "exam_result_unique" UNIQUE("exam_plan_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "ledger_event" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"student_id" text NOT NULL,
	"type" "ledger_event_type" DEFAULT 'PAYMENT' NOT NULL,
	"amount" numeric NOT NULL,
	"discount" numeric DEFAULT '0' NOT NULL,
	"ref_bill_event_id" text,
	"note" varchar,
	"recorded_by" text NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger_projection" (
	"student_id" text PRIMARY KEY NOT NULL,
	"last_ledger_version" integer DEFAULT 0 NOT NULL,
	"last_bill_version" integer DEFAULT 0 NOT NULL,
	"total_paid" numeric DEFAULT '0' NOT NULL,
	"total_discount" numeric DEFAULT '0' NOT NULL,
	"outstanding" numeric DEFAULT '0' NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "school_onboarding" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"school_details_completed" boolean DEFAULT false NOT NULL,
	"members_added" boolean DEFAULT false NOT NULL,
	"classes_created" boolean DEFAULT false NOT NULL,
	"session_configured" boolean DEFAULT false NOT NULL,
	"finance_completed" boolean DEFAULT false NOT NULL,
	"template_exam_configured" boolean DEFAULT false NOT NULL,
	"template_bill_configured" boolean DEFAULT false NOT NULL,
	"template_receipt_configured" boolean DEFAULT false NOT NULL,
	"template_idcard_configured" boolean DEFAULT false NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "school_onboarding_school_id_unique" UNIQUE("school_id")
);
--> statement-breakpoint
CREATE TABLE "school_session" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" varchar NOT NULL,
	"school_id" text NOT NULL,
	"sessionEndYear" integer NOT NULL,
	"sessionStartYear" integer NOT NULL,
	"sessionConfig" jsonb DEFAULT '{}'::jsonb,
	"finance_config" jsonb,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now(),
	CONSTRAINT "school_session_slug_unique" UNIQUE("school_id","slug")
);
--> statement-breakpoint
CREATE TABLE "school" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" varchar NOT NULL,
	"name" varchar NOT NULL,
	"location" varchar NOT NULL,
	"registrationNo" varchar,
	"logo_s3_key" varchar,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now(),
	"defaultSessionConfig" jsonb DEFAULT '{}'::jsonb,
	"finance_schema" jsonb,
	"active_session_id" text,
	"has_completed_onboarding" boolean DEFAULT false NOT NULL,
	CONSTRAINT "school_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "section" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" varchar NOT NULL,
	"label" varchar NOT NULL,
	"class_id" text NOT NULL,
	"school_id" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now(),
	CONSTRAINT "section_slug_unique" UNIQUE("class_id","slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" text PRIMARY KEY NOT NULL,
	"email" varchar NOT NULL,
	"school_id" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "student_bill_event" (
	"id" text PRIMARY KEY NOT NULL,
	"bill_event_id" text,
	"student_id" text NOT NULL,
	"amount" numeric NOT NULL,
	"line_items" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "student_bill_projection" (
	"student_id" text PRIMARY KEY NOT NULL,
	"last_event_id" text,
	"last_version" integer DEFAULT 0 NOT NULL,
	"total_billed" numeric DEFAULT '0' NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "student" (
	"id" text PRIMARY KEY NOT NULL,
	"class_id" text NOT NULL,
	"section_id" text NOT NULL,
	"school_id" text NOT NULL,
	"admission_id" text NOT NULL,
	"session_id" text NOT NULL,
	"rollNo" integer NOT NULL,
	"finance_config" jsonb,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now(),
	CONSTRAINT "student_unique_session" UNIQUE("admission_id","session_id"),
	CONSTRAINT "student_unique_rollno_per_section" UNIQUE("session_id","class_id","section_id","rollNo")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission" ADD CONSTRAINT "admission_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission" ADD CONSTRAINT "admission_admission_class_id_class_id_fk" FOREIGN KEY ("admission_class_id") REFERENCES "public"."class"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_generation_event" ADD CONSTRAINT "bill_generation_event_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_generation_event" ADD CONSTRAINT "bill_generation_event_session_id_school_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."school_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_generation_event" ADD CONSTRAINT "bill_generation_event_generated_by_staff_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class" ADD CONSTRAINT "class_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_plan" ADD CONSTRAINT "exam_plan_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_plan" ADD CONSTRAINT "exam_plan_session_id_school_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."school_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_plan" ADD CONSTRAINT "exam_plan_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_result" ADD CONSTRAINT "exam_result_exam_plan_id_exam_plan_id_fk" FOREIGN KEY ("exam_plan_id") REFERENCES "public"."exam_plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_result" ADD CONSTRAINT "exam_result_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_result" ADD CONSTRAINT "exam_result_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_result" ADD CONSTRAINT "exam_result_session_id_school_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."school_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_event" ADD CONSTRAINT "ledger_event_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_event" ADD CONSTRAINT "ledger_event_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_event" ADD CONSTRAINT "ledger_event_ref_bill_event_id_bill_generation_event_id_fk" FOREIGN KEY ("ref_bill_event_id") REFERENCES "public"."bill_generation_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_event" ADD CONSTRAINT "ledger_event_recorded_by_staff_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_projection" ADD CONSTRAINT "ledger_projection_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_onboarding" ADD CONSTRAINT "school_onboarding_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_session" ADD CONSTRAINT "school_session_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section" ADD CONSTRAINT "section_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section" ADD CONSTRAINT "section_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_bill_event" ADD CONSTRAINT "student_bill_event_bill_event_id_bill_generation_event_id_fk" FOREIGN KEY ("bill_event_id") REFERENCES "public"."bill_generation_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_bill_event" ADD CONSTRAINT "student_bill_event_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_bill_projection" ADD CONSTRAINT "student_bill_projection_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_section_id_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."section"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_admission_id_admission_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."admission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_session_id_school_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."school_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_configId_idx" ON "apikey" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "apikey_referenceId_idx" ON "apikey" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE INDEX "artifact_entity_idx" ON "artifact" USING btree ("school_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "ledger_event_student_version_idx" ON "ledger_event" USING btree ("student_id","version");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "student_bill_event_student_version_idx" ON "student_bill_event" USING btree ("student_id","version");--> statement-breakpoint
CREATE INDEX "student_bill_event_bill_event_idx" ON "student_bill_event" USING btree ("bill_event_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");