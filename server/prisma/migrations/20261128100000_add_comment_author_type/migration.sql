-- The export carries `author_type` for every comment (docs/features/import-export.md
-- §1) and a v1 file that says `agent` must come back as `agent`, so the type is
-- stored rather than derived from whether an author account still exists.
CREATE TYPE "CommentAuthorType" AS ENUM ('user', 'agent', 'anon');

ALTER TABLE "comments"
  ADD COLUMN "author_type" "CommentAuthorType" NOT NULL DEFAULT 'user';

-- A comment with no author account was written by a link or anonymous visitor.
UPDATE "comments" SET "author_type" = 'anon' WHERE "author_id" IS NULL;
