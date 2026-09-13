CREATE TABLE "school_user_role" (
	"school_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "school_user_role_school_id_user_id_role_pk" PRIMARY KEY("school_id","user_id","role")
);
--> statement-breakpoint
ALTER TABLE "school_user_role" ADD CONSTRAINT "school_user_role_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_user_role" ADD CONSTRAINT "school_user_role_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "school_user_role_user_id_idx" ON "school_user_role" USING btree ("user_id");