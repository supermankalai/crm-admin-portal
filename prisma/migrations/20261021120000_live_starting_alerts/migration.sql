-- "Starts soon, join now" alerts for online classes and PT sessions (docs/LIVE_SESSIONS.md).
ALTER TYPE "NotificationType" ADD VALUE 'LIVE_CLASS_STARTING';
ALTER TYPE "NotificationType" ADD VALUE 'LIVE_PT_STARTING';
