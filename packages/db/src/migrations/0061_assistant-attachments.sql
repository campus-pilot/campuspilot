CREATE TYPE "public"."assistant_attachment_derivative_status" AS ENUM('ready', 'unsupported');--> statement-breakpoint
CREATE TABLE "assistant_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" text,
	"item_id" text,
	"position" integer,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"width" integer,
	"height" integer,
	"s3_key" text NOT NULL,
	"derivative_status" "assistant_attachment_derivative_status" NOT NULL,
	"thumb_s3_key" text,
	"model_s3_key" text,
	"model_content_type" text,
	"model_byte_size" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attached_at" timestamp with time zone,
	CONSTRAINT "assistant_attachment_s3_key_unique" UNIQUE("s3_key"),
	CONSTRAINT "assistant_attachment_binding_check" CHECK (("assistant_attachment"."item_id" is null) = ("assistant_attachment"."conversation_id" is null) and ("assistant_attachment"."item_id" is null) = ("assistant_attachment"."attached_at" is null) and ("assistant_attachment"."item_id" is null) = ("assistant_attachment"."position" is null)),
	CONSTRAINT "assistant_attachment_derivative_check" CHECK (("assistant_attachment"."derivative_status" = 'ready') = ("assistant_attachment"."thumb_s3_key" is not null and "assistant_attachment"."model_s3_key" is not null))
);
--> statement-breakpoint
ALTER TABLE "assistant_attachment" ADD CONSTRAINT "assistant_attachment_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_attachment" ADD CONSTRAINT "assistant_attachment_conversation_id_assistant_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_attachment" ADD CONSTRAINT "assistant_attachment_item_id_assistant_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."assistant_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_attachment_unsent_idx" ON "assistant_attachment" USING btree ("school_id","user_id","created_at") WHERE "assistant_attachment"."item_id" is null;--> statement-breakpoint
CREATE INDEX "assistant_attachment_item_idx" ON "assistant_attachment" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "assistant_attachment_conversation_idx" ON "assistant_attachment" USING btree ("conversation_id");