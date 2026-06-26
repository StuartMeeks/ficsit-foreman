-- The current uploaded `.sav` for a playthrough (#61, minimal slice of #76).
-- Additive: one current save per playthrough (unique playthroughId), cascade
-- deleted with its playthrough. The bytes live on a data volume; this row holds
-- the parsed metadata that seeds the playthrough name and is shown in the UI.

-- CreateTable
CREATE TABLE "Save" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playthroughId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "saveName" TEXT,
    "version" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Save_playthroughId_fkey" FOREIGN KEY ("playthroughId") REFERENCES "Playthrough" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Save_playthroughId_key" ON "Save"("playthroughId");
