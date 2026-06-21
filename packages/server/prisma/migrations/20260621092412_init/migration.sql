-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "personality" TEXT NOT NULL DEFAULT '',
    "pioneerProfile" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "estimatedDuration" TEXT NOT NULL,
    "requiredItems" TEXT NOT NULL,
    "buildSteps" TEXT NOT NULL,
    "expectedOutput" TEXT NOT NULL,
    "notes" TEXT,
    "adaptations" TEXT,
    "completionSummary" TEXT,
    "pioneerFeedback" TEXT,
    CONSTRAINT "WorkOrder_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Message_sessionId_createdAt_idx" ON "Message"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkOrder_sessionId_status_idx" ON "WorkOrder"("sessionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_sessionId_sequenceNumber_key" ON "WorkOrder"("sessionId", "sequenceNumber");
