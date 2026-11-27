-- K5-04: per-account notification mute preferences and optional webhook channel.
CREATE TABLE "notification_prefs" (
  "user_id" TEXT NOT NULL,
  "muted_kinds" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "webhook_url" TEXT,
  "failures" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notification_prefs_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "notification_prefs"
  ADD CONSTRAINT "notification_prefs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
