-- Every table carries updatedAt (the isolation checks and conventions rely on it). History rows
-- are append-only for the app, so this only changes when a member's data is erased.
ALTER TABLE "PtAssignmentHistory" ADD COLUMN "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "PtAssignmentHistory" ALTER COLUMN "updatedAt" DROP DEFAULT;
