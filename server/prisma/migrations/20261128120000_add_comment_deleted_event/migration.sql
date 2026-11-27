-- Deleting a comment is a mutation, so it records itself (D-23). Append-only:
-- the value is added, never removed or renamed.
ALTER TYPE "EventType" ADD VALUE 'comment_deleted';
