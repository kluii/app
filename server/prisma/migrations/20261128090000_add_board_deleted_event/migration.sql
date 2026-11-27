-- Deleting a board is a mutation like any other, and the audit trail it
-- destroys is exactly the one that has to record it (D-23, D-54).
ALTER TYPE "EventType" ADD VALUE 'board_deleted';
