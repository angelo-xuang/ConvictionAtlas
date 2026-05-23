-- Migration: add dateKey columns for daily incremental upserts.
-- Run once on the server before deploying the new service code.
--
-- Safe to re-run: ADD COLUMN is wrapped in IF NOT EXISTS via PRAGMA check upstream,
-- but SQLite doesn't support IF NOT EXISTS on columns, so check before running.
-- Idempotency strategy: outer caller should verify columns absent.

BEGIN TRANSACTION;

ALTER TABLE "ManagerDecision"    ADD COLUMN "dateKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PortfolioSnapshot"  ADD COLUMN "dateKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PerformanceSnapshot" ADD COLUMN "dateKey" TEXT NOT NULL DEFAULT '';

-- Backfill dateKey from existing computedAt (UTC YYYY-MM-DD).
-- Prisma stores DateTime as ISO-8601 string in SQLite, so substr(0, 10) extracts the date.
UPDATE "ManagerDecision"
   SET "dateKey" = strftime('%Y-%m-%d', "computedAt" / 1000, 'unixepoch')
 WHERE "dateKey" = '';

UPDATE "PortfolioSnapshot"
   SET "dateKey" = strftime('%Y-%m-%d', "computedAt" / 1000, 'unixepoch')
 WHERE "dateKey" = '';

UPDATE "PerformanceSnapshot"
   SET "dateKey" = strftime('%Y-%m-%d', "computedAt" / 1000, 'unixepoch')
 WHERE "dateKey" = '';

-- Dedupe before adding unique constraints: keep the latest row per (manager, dateKey) tuple.
-- PortfolioSnapshot: pick latest computedAt per (managerId, dateKey).
DELETE FROM "PortfolioSnapshot"
 WHERE "id" NOT IN (
   SELECT "id" FROM "PortfolioSnapshot" ps1
    WHERE "computedAt" = (
      SELECT MAX("computedAt") FROM "PortfolioSnapshot" ps2
       WHERE ps2."managerId" = ps1."managerId" AND ps2."dateKey" = ps1."dateKey"
    )
 );

DELETE FROM "PerformanceSnapshot"
 WHERE "id" NOT IN (
   SELECT "id" FROM "PerformanceSnapshot" ps1
    WHERE "computedAt" = (
      SELECT MAX("computedAt") FROM "PerformanceSnapshot" ps2
       WHERE ps2."managerId" = ps1."managerId" AND ps2."dateKey" = ps1."dateKey"
    )
 );

-- ManagerDecision: keep latest per (managerId, opportunityId, dateKey).
DELETE FROM "ManagerDecision"
 WHERE "id" NOT IN (
   SELECT "id" FROM "ManagerDecision" md1
    WHERE "computedAt" = (
      SELECT MAX("computedAt") FROM "ManagerDecision" md2
       WHERE md2."managerId" = md1."managerId"
         AND md2."opportunityId" = md1."opportunityId"
         AND md2."dateKey" = md1."dateKey"
    )
 );

CREATE UNIQUE INDEX "ManagerDecision_managerId_opportunityId_dateKey_key"
    ON "ManagerDecision"("managerId", "opportunityId", "dateKey");
CREATE INDEX "ManagerDecision_managerId_dateKey_idx"
    ON "ManagerDecision"("managerId", "dateKey");

CREATE UNIQUE INDEX "PortfolioSnapshot_managerId_dateKey_key"
    ON "PortfolioSnapshot"("managerId", "dateKey");

CREATE UNIQUE INDEX "PerformanceSnapshot_managerId_dateKey_key"
    ON "PerformanceSnapshot"("managerId", "dateKey");

COMMIT;
