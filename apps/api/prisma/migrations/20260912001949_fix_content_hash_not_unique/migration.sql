-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Song" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "thumbnailUrl" TEXT,
    "durationSec" REAL NOT NULL,
    "language" TEXT,
    "languageIsUserOverride" BOOLEAN NOT NULL DEFAULT false,
    "contentHash" TEXT NOT NULL DEFAULT '',
    "clientOwnerId" TEXT NOT NULL,
    "vocalRangeJson" TEXT,
    "keyEstimateJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Song" ("artist", "clientOwnerId", "contentHash", "createdAt", "durationSec", "id", "keyEstimateJson", "language", "languageIsUserOverride", "thumbnailUrl", "title", "updatedAt", "vocalRangeJson") SELECT "artist", "clientOwnerId", "contentHash", "createdAt", "durationSec", "id", "keyEstimateJson", "language", "languageIsUserOverride", "thumbnailUrl", "title", "updatedAt", "vocalRangeJson" FROM "Song";
DROP TABLE "Song";
ALTER TABLE "new_Song" RENAME TO "Song";
CREATE INDEX "Song_clientOwnerId_idx" ON "Song"("clientOwnerId");
CREATE INDEX "Song_contentHash_idx" ON "Song"("contentHash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
