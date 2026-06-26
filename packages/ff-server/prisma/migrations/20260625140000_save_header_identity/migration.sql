-- Discrete header identity on Save (#76 PR1): powers the build-version warning
-- now and same-game recognition later. All additive + nullable, so existing
-- rows are unaffected and backfill on the next upload.

-- AlterTable
ALTER TABLE "Save" ADD COLUMN "sessionName" TEXT;
ALTER TABLE "Save" ADD COLUMN "mapName" TEXT;
ALTER TABLE "Save" ADD COLUMN "buildVersion" INTEGER;
ALTER TABLE "Save" ADD COLUMN "saveVersion" INTEGER;
ALTER TABLE "Save" ADD COLUMN "playDurationSeconds" INTEGER;
