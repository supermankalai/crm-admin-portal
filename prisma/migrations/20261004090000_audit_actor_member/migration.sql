-- Member app actions are audited with their own actor type. (Separate migration: a new enum
-- value can only be used after the transaction that adds it has committed.)
ALTER TYPE "AuditActorType" ADD VALUE IF NOT EXISTS 'MEMBER';
