-- A card created by an anonymous actor keeps the display name it was given: the
-- name is not an account, and it must survive the session that created it
-- (docs/features/links-and-anonymous.md §4).
ALTER TABLE "cards" ADD COLUMN "actor_label" TEXT;
