-- K5-05: the digest delivery state. The table existed; the columns the sender
-- needs did not. A credential is hashed at rest, and what was sent is kept so
-- the RSS feed serves the digest that was actually delivered.
ALTER TABLE "digest_prefs" ADD COLUMN "unsubscribe_hash" TEXT;
ALTER TABLE "digest_prefs" ADD COLUMN "last_digest" JSONB;
ALTER TABLE "digest_prefs" ADD COLUMN "failures" INTEGER NOT NULL DEFAULT 0;
