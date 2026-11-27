-- Exactly one owner is a database fact, not a convention (K3-05).
CREATE UNIQUE INDEX "board_members_one_owner_per_board"
  ON "board_members" ("board_id")
  WHERE "role" = 'owner';
