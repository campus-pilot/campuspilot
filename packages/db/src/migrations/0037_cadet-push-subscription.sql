CREATE TABLE "cadet_push_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"cadet_user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cadet_push_subscription" ADD CONSTRAINT "cadet_push_subscription_cadet_user_id_cadet_user_id_fk" FOREIGN KEY ("cadet_user_id") REFERENCES "public"."cadet_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cadet_push_subscription_user_endpoint_unique" ON "cadet_push_subscription" USING btree ("cadet_user_id","endpoint");--> statement-breakpoint
CREATE INDEX "cadet_push_subscription_active_idx" ON "cadet_push_subscription" USING btree ("cadet_user_id") WHERE "cadet_push_subscription"."revoked_at" is null;