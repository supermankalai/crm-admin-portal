-- AlterTable
ALTER TABLE "PushToken" ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'expo';

ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_provider" CHECK (provider IN ('expo', 'fcm'));
