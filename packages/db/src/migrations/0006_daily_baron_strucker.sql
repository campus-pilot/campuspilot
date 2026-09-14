CREATE TABLE "school_member" (
	"school_id" text NOT NULL,
	"user_id" text NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "school_member_school_id_user_id_pk" PRIMARY KEY("school_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "school_member" ADD CONSTRAINT "school_member_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_member" ADD CONSTRAINT "school_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "school_member_user_id_idx" ON "school_member" USING btree ("user_id");--> statement-breakpoint
-- Existing installations did not have a first-class membership record. Use
-- the earliest surviving role assignment only as a one-time historical
-- backfill; all new membership timestamps are written explicitly.
INSERT INTO "school_member" ("school_id", "user_id", "added_at")
SELECT "school_id", "user_id", min("created_at")
FROM "school_user_role"
GROUP BY "school_id", "user_id";--> statement-breakpoint
ALTER TABLE "school_user_role" ADD CONSTRAINT "school_user_role_member_fk" FOREIGN KEY ("school_id","user_id") REFERENCES "public"."school_member"("school_id","user_id") ON DELETE cascade ON UPDATE no action;
