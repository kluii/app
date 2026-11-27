-- K5-05: the digest settings write is a mutation, so it is in the event log
-- like every other one. ADD VALUE is not used in this transaction, only added.
ALTER TYPE "EventType" ADD VALUE 'digest_updated';
