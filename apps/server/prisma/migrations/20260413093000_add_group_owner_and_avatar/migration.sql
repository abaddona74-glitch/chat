-- Add OWNER role for group members and avatar URL for groups
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'GroupRole' AND e.enumlabel = 'OWNER'
  ) THEN
    ALTER TYPE "GroupRole" ADD VALUE 'OWNER';
  END IF;
END
$$;

ALTER TABLE "Group"
ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;

UPDATE "GroupMember" gm
SET "role" = 'OWNER'
FROM "Group" g
WHERE gm."groupId" = g."id"
  AND gm."userId" = g."createdById"
  AND gm."role" <> 'OWNER';
