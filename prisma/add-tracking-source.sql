-- Run once against the shared Neon database before deploying the tracking change.
-- Existing demo/browser updates remain LEGACY and are not shown as phone GPS.
ALTER TABLE "TrackingUpdate"
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'LEGACY';
