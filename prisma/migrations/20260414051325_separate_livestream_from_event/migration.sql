-- Migration: separate_livestream_from_event
-- Remove eventId from LiveRoom (livestream now standalone)

-- Step 1: Set eventId to NULL for all existing rooms (required before dropping constraint)
ALTER TABLE "LiveRoom" ALTER COLUMN "eventId" DROP NOT NULL;

-- Step 2: Clear existing eventId values
UPDATE "LiveRoom" SET "eventId" = NULL;

-- Step 3: Drop foreign key constraint
ALTER TABLE "LiveRoom" DROP CONSTRAINT "LiveRoom_eventId_fkey";

-- Step 4: Drop the column
ALTER TABLE "LiveRoom" DROP COLUMN "eventId";

-- Step 5: Drop the unique constraint on eventId
-- (already dropped above since it was tied to the FK)
