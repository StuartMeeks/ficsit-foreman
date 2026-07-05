-- AlterTable
-- Explore orders (#207) are a variant of WorkOrder: a discriminator plus a JSON waypoints
-- column. Both additive with defaults, so existing (build) orders are unaffected.
ALTER TABLE "WorkOrder" ADD COLUMN "orderType" TEXT NOT NULL DEFAULT 'build';
ALTER TABLE "WorkOrder" ADD COLUMN "waypoints" TEXT NOT NULL DEFAULT '[]';
