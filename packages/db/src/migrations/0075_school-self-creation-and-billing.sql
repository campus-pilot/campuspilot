-- Self-service school creation (docs/school-creation.md). A person may create
-- `user.school_creation_limit` schools over the life of the account (1 by
-- default); every creation is a `school_creation` row that outlives the
-- school, so deleting, handing over or leaving a school never gives the
-- allowance back. `school.owner_user_id` names the accountable owner, who
-- cannot be removed or lose the principal role through school procedures.
-- Existing schools keep no owner until a platform administrator names one.
--
-- School billing (docs/school-billing.md): `school_trial` becomes
-- `school_billing_period` (kinds trial, paid, complimentary), with the
-- catalogue of `subscription_price`s and the `school_invoice`s that pay for
-- periods. Rows mirror a payment provider's Price and Invoice so one can be
-- connected later; today they are written by hand (`provider = 'manual'`).
CREATE TABLE "school_invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"status" text NOT NULL,
	"tier" text NOT NULL,
	"price_id" text,
	"currency" text NOT NULL,
	"unit_amount_minor" integer NOT NULL,
	"period_count" integer NOT NULL,
	"amount_minor" integer NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"provider" text DEFAULT 'manual' NOT NULL,
	"provider_invoice_id" text,
	"payment_reference" text,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_invoice_provider_invoice_id_unique" UNIQUE("provider_invoice_id"),
	CONSTRAINT "school_invoice_status_check" CHECK ("school_invoice"."status" in ('open', 'paid', 'void')),
	CONSTRAINT "school_invoice_tier_check" CHECK ("school_invoice"."tier" in ('plus', 'pro', 'enterprise')),
	CONSTRAINT "school_invoice_currency_check" CHECK ("school_invoice"."currency" in ('INR')),
	CONSTRAINT "school_invoice_provider_check" CHECK ("school_invoice"."provider" in ('manual', 'stripe')),
	CONSTRAINT "school_invoice_amounts_check" CHECK ("school_invoice"."unit_amount_minor" >= 0 and "school_invoice"."amount_minor" >= 0 and "school_invoice"."period_count" >= 1),
	CONSTRAINT "school_invoice_period_check" CHECK ("school_invoice"."period_end" > "school_invoice"."period_start"),
	CONSTRAINT "school_invoice_paid_check" CHECK (("school_invoice"."status" = 'open') = ("school_invoice"."paid_at" is null)),
	CONSTRAINT "school_invoice_void_check" CHECK (("school_invoice"."status" = 'void') = ("school_invoice"."voided_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "subscription_price" (
	"id" text PRIMARY KEY NOT NULL,
	"tier" text NOT NULL,
	"currency" text NOT NULL,
	"unit_amount_minor" integer NOT NULL,
	"period_days" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"provider_price_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_price_provider_price_id_unique" UNIQUE("provider_price_id"),
	CONSTRAINT "subscription_price_tier_check" CHECK ("subscription_price"."tier" in ('plus', 'pro', 'enterprise')),
	CONSTRAINT "subscription_price_currency_check" CHECK ("subscription_price"."currency" in ('INR')),
	CONSTRAINT "subscription_price_amount_check" CHECK ("subscription_price"."unit_amount_minor" >= 0),
	CONSTRAINT "subscription_price_period_days_check" CHECK ("subscription_price"."period_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "school_creation_request" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"requested_limit" integer NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"granted_limit" integer,
	"decision_note" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_creation_request_status_check" CHECK ("school_creation_request"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "school_creation_request_requested_limit_check" CHECK ("school_creation_request"."requested_limit" >= 1),
	CONSTRAINT "school_creation_request_granted_limit_check" CHECK (("school_creation_request"."status" = 'approved') = ("school_creation_request"."granted_limit" is not null) and ("school_creation_request"."granted_limit" is null or "school_creation_request"."granted_limit" >= 0)),
	CONSTRAINT "school_creation_request_decided_at_check" CHECK (("school_creation_request"."status" = 'pending') = ("school_creation_request"."decided_at" is null))
);
--> statement-breakpoint
CREATE TABLE "school_creation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"school_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- A trial becomes one kind of billing period (docs/school-billing.md); the
-- rows keep their ids. The EXCLUDE constraint from 0074 moves with the table
-- and keeps refusing overlapping periods of one school.
ALTER TABLE "school_trial" RENAME TO "school_billing_period";--> statement-breakpoint
ALTER TABLE "school_billing_period" RENAME CONSTRAINT "school_trial_no_overlap" TO "school_billing_period_no_overlap";--> statement-breakpoint
ALTER TABLE "school_billing_period" DROP CONSTRAINT "school_trial_tier_check";--> statement-breakpoint
ALTER TABLE "school_billing_period" DROP CONSTRAINT "school_trial_ends_after_start_check";--> statement-breakpoint
ALTER TABLE "school_billing_period" DROP CONSTRAINT "school_trial_ended_after_start_check";--> statement-breakpoint
ALTER TABLE "school_billing_period" DROP CONSTRAINT "school_trial_school_id_school_id_fk";
--> statement-breakpoint
ALTER TABLE "school_billing_period" DROP CONSTRAINT "school_trial_created_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "school_billing_period" DROP CONSTRAINT "school_trial_ended_by_user_id_fk";
--> statement-breakpoint
DROP INDEX "school_trial_school_id_idx";--> statement-breakpoint
DROP INDEX "school_trial_created_by_idx";--> statement-breakpoint
DROP INDEX "school_trial_ended_by_idx";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "school_creation_limit" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "school" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
-- Every row so far is an administrator's trial.
ALTER TABLE "school_billing_period" ADD COLUMN "kind" text DEFAULT 'trial' NOT NULL;--> statement-breakpoint
ALTER TABLE "school_billing_period" ALTER COLUMN "kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "school_billing_period" ADD COLUMN "invoice_id" text;--> statement-breakpoint
ALTER TABLE "school_invoice" ADD CONSTRAINT "school_invoice_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_invoice" ADD CONSTRAINT "school_invoice_price_id_subscription_price_id_fk" FOREIGN KEY ("price_id") REFERENCES "public"."subscription_price"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_invoice" ADD CONSTRAINT "school_invoice_voided_by_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_invoice" ADD CONSTRAINT "school_invoice_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_price" ADD CONSTRAINT "subscription_price_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_creation_request" ADD CONSTRAINT "school_creation_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_creation_request" ADD CONSTRAINT "school_creation_request_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_creation" ADD CONSTRAINT "school_creation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_creation" ADD CONSTRAINT "school_creation_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "school_invoice_school_id_idx" ON "school_invoice" USING btree ("school_id","period_start");--> statement-breakpoint
CREATE INDEX "school_invoice_price_id_idx" ON "school_invoice" USING btree ("price_id");--> statement-breakpoint
CREATE INDEX "school_invoice_created_by_idx" ON "school_invoice" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "school_invoice_voided_by_idx" ON "school_invoice" USING btree ("voided_by");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_price_one_active_key" ON "subscription_price" USING btree ("tier","currency") WHERE "subscription_price"."active";--> statement-breakpoint
CREATE INDEX "subscription_price_created_by_idx" ON "subscription_price" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "school_creation_request_user_id_idx" ON "school_creation_request" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "school_creation_request_status_idx" ON "school_creation_request" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "school_creation_request_decided_by_idx" ON "school_creation_request" USING btree ("decided_by");--> statement-breakpoint
CREATE UNIQUE INDEX "school_creation_request_one_pending_key" ON "school_creation_request" USING btree ("user_id") WHERE "school_creation_request"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "school_creation_user_id_idx" ON "school_creation" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "school_creation_school_id_key" ON "school_creation" USING btree ("school_id");--> statement-breakpoint
ALTER TABLE "school" ADD CONSTRAINT "school_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_billing_period" ADD CONSTRAINT "school_billing_period_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_billing_period" ADD CONSTRAINT "school_billing_period_invoice_id_school_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."school_invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_billing_period" ADD CONSTRAINT "school_billing_period_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_billing_period" ADD CONSTRAINT "school_billing_period_ended_by_user_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "school_owner_user_id_idx" ON "school" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "school_billing_period_school_id_idx" ON "school_billing_period" USING btree ("school_id","starts_at");--> statement-breakpoint
CREATE INDEX "school_billing_period_invoice_id_idx" ON "school_billing_period" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "school_billing_period_created_by_idx" ON "school_billing_period" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "school_billing_period_ended_by_idx" ON "school_billing_period" USING btree ("ended_by");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_school_creation_limit_check" CHECK ("user"."school_creation_limit" >= 0);--> statement-breakpoint
ALTER TABLE "school_billing_period" ADD CONSTRAINT "school_billing_period_kind_check" CHECK ("school_billing_period"."kind" in ('trial', 'paid', 'complimentary'));--> statement-breakpoint
ALTER TABLE "school_billing_period" ADD CONSTRAINT "school_billing_period_tier_check" CHECK ("school_billing_period"."tier" in ('plus', 'pro', 'enterprise'));--> statement-breakpoint
ALTER TABLE "school_billing_period" ADD CONSTRAINT "school_billing_period_ends_after_start_check" CHECK ("school_billing_period"."ends_at" > "school_billing_period"."starts_at");--> statement-breakpoint
ALTER TABLE "school_billing_period" ADD CONSTRAINT "school_billing_period_ended_after_start_check" CHECK ("school_billing_period"."ended_at" >= "school_billing_period"."starts_at");--> statement-breakpoint
ALTER TABLE "school_billing_period" ADD CONSTRAINT "school_billing_period_invoice_check" CHECK (("school_billing_period"."kind" = 'paid') = ("school_billing_period"."invoice_id" is not null));