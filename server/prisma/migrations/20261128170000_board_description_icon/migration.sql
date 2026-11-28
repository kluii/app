-- A board can say what it is (description) and carry a mark (icon, a name
-- from the closed set BOARD_ICONS, D-60). Both nullable: absent means unset.
ALTER TABLE "boards" ADD COLUMN "description" TEXT, ADD COLUMN "icon" TEXT;
