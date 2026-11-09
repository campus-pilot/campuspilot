CREATE TYPE "public"."notification_delivery_channel" AS ENUM('web_push', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."notification_delivery_status" AS ENUM('owed', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."notification_event_status" AS ENUM('pending', 'dispatched', 'failed');--> statement-breakpoint
CREATE TYPE "public"."notification_recipient_kind" AS ENUM('staff_user', 'admission');--> statement-breakpoint
CREATE TYPE "public"."notification_skip_reason" AS ENUM('no_number', 'not_verified', 'no_consent', 'opted_out', 'no_subscription', 'demo_school', 'disabled');--> statement-breakpoint
CREATE TABLE "notification_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"notification_id" text NOT NULL,
	"school_id" text NOT NULL,
	"channel" "notification_delivery_channel" NOT NULL,
	"destination" text,
	"status" "notification_delivery_status" NOT NULL,
	"skip_reason" "notification_skip_reason",
	"provider_message_id" text,
	"error_code" text,
	"error_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_delivery_skip_reason_check" CHECK (("notification_delivery"."status" = 'skipped') = ("notification_delivery"."skip_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "notification_event" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"recipients" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "notification_event_status" DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp with time zone,
	"submit_invocation_id" text,
	"submit_attempts" integer DEFAULT 0 NOT NULL,
	"last_submit_error" text,
	"invocation_id" text,
	"notification_count" integer,
	"dispatched_at" timestamp with time zone,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"school_id" text NOT NULL,
	"recipient_kind" "notification_recipient_kind" NOT NULL,
	"user_id" text,
	"admission_id" text,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	CONSTRAINT "notification_recipient_check" CHECK (("notification"."recipient_kind" = 'staff_user' and "notification"."user_id" is not null and "notification"."admission_id" is null) or ("notification"."recipient_kind" = 'admission' and "notification"."admission_id" is not null and "notification"."user_id" is null)),
	CONSTRAINT "notification_dismiss_read_check" CHECK ("notification"."dismissed_at" is null or "notification"."read_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_notification_id_notification_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notification"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_event" ADD CONSTRAINT "notification_event_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_event" ADD CONSTRAINT "notification_event_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_event_id_notification_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."notification_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_admission_id_admission_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."admission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_delivery_provider_message_unique" ON "notification_delivery" USING btree ("channel","provider_message_id") WHERE "notification_delivery"."provider_message_id" is not null;--> statement-breakpoint
CREATE INDEX "notification_delivery_notification_idx" ON "notification_delivery" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "notification_delivery_school_idx" ON "notification_delivery" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "notification_delivery_pending_idx" ON "notification_delivery" USING btree ("status","created_at") WHERE "notification_delivery"."status" in ('owed', 'sending');--> statement-breakpoint
CREATE UNIQUE INDEX "notification_event_school_key_unique" ON "notification_event" USING btree ("school_id","key");--> statement-breakpoint
CREATE INDEX "notification_event_status_idx" ON "notification_event" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "notification_event_created_idx" ON "notification_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notification_staff_list_idx" ON "notification" USING btree ("user_id","school_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "notification"."recipient_kind" = 'staff_user';--> statement-breakpoint
CREATE INDEX "notification_admission_list_idx" ON "notification" USING btree ("admission_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "notification"."recipient_kind" = 'admission';--> statement-breakpoint
CREATE INDEX "notification_staff_unread_idx" ON "notification" USING btree ("user_id","school_id") WHERE "notification"."recipient_kind" = 'staff_user' and "notification"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notification_admission_unread_idx" ON "notification" USING btree ("admission_id") WHERE "notification"."recipient_kind" = 'admission' and "notification"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notification_event_idx" ON "notification" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "notification_school_idx" ON "notification" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "notification_created_idx" ON "notification" USING btree ("created_at");