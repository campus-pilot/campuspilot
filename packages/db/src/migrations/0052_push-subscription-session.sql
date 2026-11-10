ALTER TABLE "cadet_push_subscription" ADD COLUMN "cadet_session_id" text;--> statement-breakpoint
ALTER TABLE "cadet_push_subscription" ADD CONSTRAINT "cadet_push_subscription_cadet_session_id_cadet_session_id_fk" FOREIGN KEY ("cadet_session_id") REFERENCES "public"."cadet_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cadet_push_subscription_session_idx" ON "cadet_push_subscription" USING btree ("cadet_session_id");--> statement-breakpoint
-- A device's notifications end with the Cadet Portal session that turned
-- them on, whichever way that session ends: sign-out, "sign out everywhere"
-- (revoke-session, revoke-sessions, revoke-other-sessions), a staff password
-- reset or revocation, the deletion of an expired session, or a path added
-- later. Every one of them deletes the cadet_session row, so the revocation
-- is decided here and not in each caller. It runs BEFORE the delete, while
-- the subscription still names the session (the foreign key then clears the
-- link; revoked_at is what remains).
CREATE OR REPLACE FUNCTION "public"."cadet_session_revoke_push_subscriptions"()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
	UPDATE "public"."cadet_push_subscription"
		SET "revoked_at" = now(), "updated_at" = now()
		WHERE "cadet_session_id" = OLD."id" AND "revoked_at" IS NULL;
	RETURN OLD;
END; $$;--> statement-breakpoint
CREATE TRIGGER "cadet_session_revokes_push_subscriptions" BEFORE DELETE ON "public"."cadet_session" FOR EACH ROW EXECUTE FUNCTION "public"."cadet_session_revoke_push_subscriptions"();--> statement-breakpoint
COMMENT ON FUNCTION "public"."cadet_session_revoke_push_subscriptions"() IS 'Revokes the web push subscriptions a Cadet Portal session turned on when that session row is deleted, by any path.';
