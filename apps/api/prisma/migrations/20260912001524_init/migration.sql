-- CreateTable
CREATE TABLE "Song" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "thumbnailUrl" TEXT,
    "durationSec" REAL NOT NULL,
    "language" TEXT,
    "languageIsUserOverride" BOOLEAN NOT NULL DEFAULT false,
    "contentHash" TEXT NOT NULL,
    "clientOwnerId" TEXT NOT NULL,
    "vocalRangeJson" TEXT,
    "keyEstimateJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SourceReference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "songId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "youtubeVideoId" TEXT,
    "youtubeUrl" TEXT,
    "channelTitle" TEXT,
    "sourceThumbnailUrl" TEXT,
    "sourceDurationSec" REAL,
    CONSTRAINT "SourceReference_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AudioAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "songId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT,
    "durationSec" REAL,
    "sizeBytes" INTEGER,
    "providerName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AudioAsset_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProcessingJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "songId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "audioSourceKind" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProcessingJob_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProcessingStage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "progress" REAL,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "error" TEXT,
    "detail" TEXT,
    CONSTRAINT "ProcessingStage_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProcessingJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LyricLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "songId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "start" REAL NOT NULL,
    "end" REAL NOT NULL,
    "sectionId" TEXT,
    CONSTRAINT "LyricLine_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LyricWord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lineId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "start" REAL NOT NULL,
    "end" REAL NOT NULL,
    "confidence" REAL NOT NULL,
    "isUserCorrected" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "LyricWord_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "LyricLine" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserCorrection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "wordId" TEXT NOT NULL,
    "previousText" TEXT NOT NULL,
    "newText" TEXT NOT NULL,
    "correctedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT,
    CONSTRAINT "UserCorrection_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "LyricWord" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SongSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "songId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "start" REAL NOT NULL,
    "end" REAL NOT NULL,
    "confidence" REAL NOT NULL,
    "isEstimated" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "SongSection_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MelodyNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "songId" TEXT NOT NULL,
    "start" REAL NOT NULL,
    "end" REAL NOT NULL,
    "midi" INTEGER NOT NULL,
    "noteName" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "meanFrequencyHz" REAL NOT NULL,
    CONSTRAINT "MelodyNote_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DifficultPart" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "songId" TEXT NOT NULL,
    "start" REAL NOT NULL,
    "end" REAL NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "severity" REAL NOT NULL,
    CONSTRAINT "DifficultPart_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PracticeSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "songId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "PracticeSession_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Song_contentHash_key" ON "Song"("contentHash");

-- CreateIndex
CREATE INDEX "Song_clientOwnerId_idx" ON "Song"("clientOwnerId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceReference_songId_key" ON "SourceReference"("songId");

-- CreateIndex
CREATE INDEX "AudioAsset_songId_kind_idx" ON "AudioAsset"("songId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingJob_songId_key" ON "ProcessingJob"("songId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingStage_jobId_name_key" ON "ProcessingStage"("jobId", "name");

-- CreateIndex
CREATE INDEX "LyricLine_songId_idx" ON "LyricLine"("songId");

-- CreateIndex
CREATE INDEX "LyricWord_lineId_idx" ON "LyricWord"("lineId");

-- CreateIndex
CREATE INDEX "SongSection_songId_idx" ON "SongSection"("songId");

-- CreateIndex
CREATE INDEX "MelodyNote_songId_idx" ON "MelodyNote"("songId");

-- CreateIndex
CREATE INDEX "DifficultPart_songId_idx" ON "DifficultPart"("songId");

-- CreateIndex
CREATE INDEX "PracticeSession_songId_idx" ON "PracticeSession"("songId");
