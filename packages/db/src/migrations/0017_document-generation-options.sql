ALTER TABLE "artifact" ADD COLUMN "generation_options" jsonb DEFAULT '{}'::jsonb NOT NULL;
