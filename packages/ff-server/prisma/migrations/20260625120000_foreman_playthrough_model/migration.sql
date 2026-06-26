-- Foreman / Playthrough domain model (#86; see docs/playthroughs.md).
--
-- Today's `Session` is really "a playthrough of a particular save, with a chosen
-- foreman". This migration introduces a reusable `Foreman` persona, renames
-- `Session` -> `Playthrough`, and renames the `sessionId` foreign keys on
-- `Message` / `WorkOrder` -> `playthroughId`. It is data-preserving:
--   * each distinct (userId, personality) becomes one `Foreman` (dedup);
--   * each `Session` becomes a `Playthrough` carrying its pioneerProfile, summary,
--     messages and work orders, pointed at the matching foreman;
--   * `personality` moves off the playthrough onto the foreman;
--   * `name` is left NULL (a sensible default is derived from the save in #76).
-- `AuthSession` (the Better Auth login cookie) is untouched.

-- CreateTable
CREATE TABLE "Foreman" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "personality" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Foreman_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Extract one foreman per distinct (userId, personality). Done while the old
-- `Session` table still exists. `userId IS NULL` rows group together (a single
-- anonymous foreman per distinct personality), mirroring anonymous playthroughs.
INSERT INTO "Foreman" ("id", "userId", "name", "personality", "createdAt", "updatedAt")
SELECT lower(hex(randomblob(16))), "userId", 'Foreman', "personality", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "userId", "personality" FROM "Session");

-- CreateIndex
CREATE INDEX "Foreman_userId_idx" ON "Foreman"("userId");

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- Session -> Playthrough. Each playthrough is attached to the foreman extracted
-- from its (userId, personality); `personality` is dropped here (now on Foreman).
CREATE TABLE "new_Playthrough" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "foremanId" TEXT NOT NULL,
    "name" TEXT,
    "pioneerProfile" TEXT NOT NULL DEFAULT '',
    "summary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Playthrough_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Playthrough_foremanId_fkey" FOREIGN KEY ("foremanId") REFERENCES "Foreman" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Playthrough" ("id", "userId", "foremanId", "name", "pioneerProfile", "summary", "createdAt", "updatedAt")
SELECT s."id", s."userId", f."id", NULL, s."pioneerProfile", s."summary", s."createdAt", s."updatedAt"
FROM "Session" s
JOIN "Foreman" f ON f."personality" = s."personality" AND f."userId" IS s."userId";
DROP TABLE "Session";
ALTER TABLE "new_Playthrough" RENAME TO "Playthrough";
CREATE INDEX "Playthrough_userId_idx" ON "Playthrough"("userId");
CREATE INDEX "Playthrough_foremanId_idx" ON "Playthrough"("foremanId");

-- Message.sessionId -> playthroughId.
CREATE TABLE "new_Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playthroughId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_playthroughId_fkey" FOREIGN KEY ("playthroughId") REFERENCES "Playthrough" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Message" ("id", "playthroughId", "role", "content", "createdAt")
SELECT "id", "sessionId", "role", "content", "createdAt" FROM "Message";
DROP TABLE "Message";
ALTER TABLE "new_Message" RENAME TO "Message";
CREATE INDEX "Message_playthroughId_createdAt_idx" ON "Message"("playthroughId", "createdAt");

-- WorkOrder.sessionId -> playthroughId (all other columns unchanged).
CREATE TABLE "new_WorkOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playthroughId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "objective" TEXT,
    "strategicSignificance" TEXT,
    "successCondition" TEXT,
    "tier" INTEGER,
    "notes" TEXT,
    "locationRecommendation" TEXT,
    "resourceNodes" TEXT,
    "machines" TEXT NOT NULL DEFAULT '[]',
    "buildMaterials" TEXT NOT NULL DEFAULT '[]',
    "recipes" TEXT NOT NULL DEFAULT '[]',
    "expectedOutputs" TEXT NOT NULL DEFAULT '[]',
    "buildSteps" TEXT NOT NULL DEFAULT '[]',
    "opportunities" TEXT,
    "blockedReason" TEXT,
    "blockedResolutionHint" TEXT,
    "startedAt" DATETIME,
    "pausedAt" DATETIME,
    "blockedAt" DATETIME,
    "completedAt" DATETIME,
    "hoursLogged" REAL,
    "completionSummary" TEXT,
    "pioneerFeedback" TEXT,
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "lastAcknowledgedRevision" INTEGER,
    "parentWorkOrderId" TEXT,
    "relationshipToParent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkOrder_playthroughId_fkey" FOREIGN KEY ("playthroughId") REFERENCES "Playthrough" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_WorkOrder" (
    "id", "playthroughId", "sequenceNumber", "state", "version", "title", "goal", "objective",
    "strategicSignificance", "successCondition", "tier", "notes", "locationRecommendation",
    "resourceNodes", "machines", "buildMaterials", "recipes", "expectedOutputs", "buildSteps",
    "opportunities", "blockedReason", "blockedResolutionHint", "startedAt", "pausedAt", "blockedAt",
    "completedAt", "hoursLogged", "completionSummary", "pioneerFeedback", "currentRevision",
    "lastAcknowledgedRevision", "parentWorkOrderId", "relationshipToParent", "createdAt", "updatedAt"
)
SELECT
    "id", "sessionId", "sequenceNumber", "state", "version", "title", "goal", "objective",
    "strategicSignificance", "successCondition", "tier", "notes", "locationRecommendation",
    "resourceNodes", "machines", "buildMaterials", "recipes", "expectedOutputs", "buildSteps",
    "opportunities", "blockedReason", "blockedResolutionHint", "startedAt", "pausedAt", "blockedAt",
    "completedAt", "hoursLogged", "completionSummary", "pioneerFeedback", "currentRevision",
    "lastAcknowledgedRevision", "parentWorkOrderId", "relationshipToParent", "createdAt", "updatedAt"
FROM "WorkOrder";
DROP TABLE "WorkOrder";
ALTER TABLE "new_WorkOrder" RENAME TO "WorkOrder";
CREATE INDEX "WorkOrder_playthroughId_state_idx" ON "WorkOrder"("playthroughId", "state");
CREATE INDEX "WorkOrder_parentWorkOrderId_idx" ON "WorkOrder"("parentWorkOrderId");
CREATE UNIQUE INDEX "WorkOrder_playthroughId_sequenceNumber_key" ON "WorkOrder"("playthroughId", "sequenceNumber");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
