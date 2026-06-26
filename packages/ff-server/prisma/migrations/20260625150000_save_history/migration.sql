-- DropIndex
DROP INDEX "Save_playthroughId_key";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Playthrough" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "foremanId" TEXT NOT NULL,
    "name" TEXT,
    "pioneerProfile" TEXT NOT NULL DEFAULT '',
    "summary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "currentSaveId" TEXT,
    CONSTRAINT "Playthrough_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Playthrough_foremanId_fkey" FOREIGN KEY ("foremanId") REFERENCES "Foreman" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Playthrough_currentSaveId_fkey" FOREIGN KEY ("currentSaveId") REFERENCES "Save" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Playthrough" ("createdAt", "foremanId", "id", "name", "pioneerProfile", "summary", "updatedAt", "userId") SELECT "createdAt", "foremanId", "id", "name", "pioneerProfile", "summary", "updatedAt", "userId" FROM "Playthrough";
DROP TABLE "Playthrough";
ALTER TABLE "new_Playthrough" RENAME TO "Playthrough";
CREATE UNIQUE INDEX "Playthrough_currentSaveId_key" ON "Playthrough"("currentSaveId");
CREATE INDEX "Playthrough_userId_idx" ON "Playthrough"("userId");
CREATE INDEX "Playthrough_foremanId_idx" ON "Playthrough"("foremanId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Save_playthroughId_idx" ON "Save"("playthroughId");

-- Data migration: each existing playthrough's single (1–1) save becomes its
-- current save. The on-disk files are relocated to the per-save layout by the
-- server's idempotent startup reconcile.
UPDATE "Playthrough"
SET "currentSaveId" = (
  SELECT "id" FROM "Save" WHERE "Save"."playthroughId" = "Playthrough"."id" LIMIT 1
)
WHERE "currentSaveId" IS NULL;
