-- AlterTable
-- better-auth >= 1.6.22 adds account-level verification lockout to the twoFactor plugin:
-- a failed-attempt counter and a lock expiry. Both are additive (default 0 / nullable).
ALTER TABLE "twoFactor" ADD COLUMN "failedVerificationCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "twoFactor" ADD COLUMN "lockedUntil" DATETIME;
