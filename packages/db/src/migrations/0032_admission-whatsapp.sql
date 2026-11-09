ALTER TABLE "admission" ADD COLUMN "whatsapp_no" varchar;--> statement-breakpoint
ALTER TABLE "admission" ADD COLUMN "whatsapp_same_as_phone" boolean;--> statement-breakpoint
ALTER TABLE "admission" ADD COLUMN "whatsapp_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "admission" ADD COLUMN "whatsapp_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "admission" ADD CONSTRAINT "admission_whatsapp_same_as_phone_check" CHECK ("admission"."whatsapp_same_as_phone" is not true or "admission"."whatsapp_no" = "admission"."phone_no");