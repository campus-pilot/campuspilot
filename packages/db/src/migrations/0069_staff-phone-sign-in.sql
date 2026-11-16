ALTER TABLE "user" ADD COLUMN "email_is_placeholder" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone_number" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone_number_verified" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_phone_number_unique" UNIQUE("phone_number");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_placeholder_email_has_phone" CHECK ("user"."email_is_placeholder" = false or "user"."phone_number" is not null);