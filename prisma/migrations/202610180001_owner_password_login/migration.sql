-- Owner passwords remain in the owner-only table, outside staff authentication access.
ALTER TABLE "OwnerIdentity" ADD COLUMN "passwordHash" TEXT, ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
