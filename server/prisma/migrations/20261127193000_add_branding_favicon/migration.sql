-- Additive K5-01 migration: optional favicon URL on singleton instance_settings.
ALTER TABLE "instance_settings" ADD COLUMN "favicon_url" TEXT;
