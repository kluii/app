-- `private` means no share policy at all (docs/permissions.md §4.3). The API
-- rejects a PATCH that tries to set one; this is the constraint underneath it.
--
-- Normalise first: a board row can already violate the rule (the API accepted
-- `link_role` on a private board until now), and a bare ADD CONSTRAINT would
-- abort the boot migration on live data.
UPDATE "boards"
   SET "link_role" = 'none',
       "anon_write" = 'off',
       "link_suffix" = NULL
 WHERE "visibility" = 'private'
   AND ("link_role" <> 'none' OR "anon_write" <> 'off' OR "link_suffix" IS NOT NULL);

ALTER TABLE "boards" ADD CONSTRAINT "boards_private_has_no_share_policy"
  CHECK ("visibility" <> 'private' OR ("link_role" = 'none' AND "anon_write" = 'off'));
