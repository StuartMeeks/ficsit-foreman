-- Work Orders v2 (see WORK_ORDER_SPEC.md).
--
-- Expands the WorkOrder model (plan + execution split), adds revision snapshots
-- and an append-only audit trail, and migrates v1 data:
--   * status -> state, with `abandoned` -> `superseded` (in v1, `abandoned` was
--     only ever set as a consequence of supersession).
--   * goal backfilled from the old objective (falling back to the title).
--   * v1 flat lists (requiredItems / buildSteps / expectedOutput) are NOT copied
--     into the new structured columns — their shapes differ — so they reset to
--     empty; the title/goal/objective and close-out fields are preserved.
--   * each migrated order gets an initial revision snapshot and a migration_event
--     audit row noting its previous status.

-- CreateTable
CREATE TABLE "WorkOrderRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workOrderId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "reason" TEXT,
    "changeSummary" TEXT,
    "planSnapshot" TEXT NOT NULL,
    CONSTRAINT "WorkOrderRevision_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkOrderAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workOrderId" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "revisionNumber" INTEGER,
    "previousRevisionNumber" INTEGER,
    "note" TEXT,
    "details" TEXT,
    CONSTRAINT "WorkOrderAuditEvent_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Backfill an initial revision snapshot for every existing (v1) work order.
-- Done while the old WorkOrder table (and its columns) still exists.
INSERT INTO "WorkOrderRevision" ("id", "workOrderId", "revisionNumber", "createdAt", "createdBy", "changeSummary", "planSnapshot")
SELECT
    lower(hex(randomblob(16))),
    "id",
    1,
    CURRENT_TIMESTAMP,
    'System',
    'Migrated from v1.',
    json_object(
        'title', "title",
        'goal', COALESCE(NULLIF("objective", ''), "title"),
        'objective', "objective",
        'machines', json('[]'),
        'buildMaterials', json('[]'),
        'buildSteps', json('[]'),
        'recipes', json('[]'),
        'expectedOutputs', json('[]')
    )
FROM "WorkOrder";

-- Migration audit event per existing order, recording the prior v1 status.
INSERT INTO "WorkOrderAuditEvent" ("id", "workOrderId", "timestamp", "actor", "eventType", "revisionNumber", "note")
SELECT
    lower(hex(randomblob(16))),
    "id",
    CURRENT_TIMESTAMP,
    'System',
    'migration_event',
    1,
    'Migrated to v2. Previous status was ''' || "status" || '''.'
FROM "WorkOrder";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WorkOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "objective" TEXT,
    "strategicSignificance" TEXT,
    "successCondition" TEXT,
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
    CONSTRAINT "WorkOrder_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_WorkOrder" (
    "id", "sessionId", "sequenceNumber", "state", "version", "title", "goal", "objective",
    "completedAt", "completionSummary", "pioneerFeedback", "currentRevision", "createdAt", "updatedAt"
)
SELECT
    "id",
    "sessionId",
    "sequenceNumber",
    CASE "status"
        WHEN 'active' THEN 'active'
        WHEN 'completed' THEN 'completed'
        ELSE 'superseded'
    END,
    "version",
    "title",
    COALESCE(NULLIF("objective", ''), "title"),
    "objective",
    "completedAt",
    "completionSummary",
    "pioneerFeedback",
    1,
    "issuedAt",
    "issuedAt"
FROM "WorkOrder";
DROP TABLE "WorkOrder";
ALTER TABLE "new_WorkOrder" RENAME TO "WorkOrder";
CREATE INDEX "WorkOrder_sessionId_state_idx" ON "WorkOrder"("sessionId", "state");
CREATE INDEX "WorkOrder_parentWorkOrderId_idx" ON "WorkOrder"("parentWorkOrderId");
CREATE UNIQUE INDEX "WorkOrder_sessionId_sequenceNumber_key" ON "WorkOrder"("sessionId", "sequenceNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "WorkOrderRevision_workOrderId_idx" ON "WorkOrderRevision"("workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrderRevision_workOrderId_revisionNumber_key" ON "WorkOrderRevision"("workOrderId", "revisionNumber");

-- CreateIndex
CREATE INDEX "WorkOrderAuditEvent_workOrderId_timestamp_idx" ON "WorkOrderAuditEvent"("workOrderId", "timestamp");
