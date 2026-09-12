import { prisma } from "../db/client";

/** Deletes all rows in dependency order so each test file starts from a clean database. */
export async function resetDb(): Promise<void> {
  await prisma.userCorrection.deleteMany();
  await prisma.lyricWord.deleteMany();
  await prisma.lyricLine.deleteMany();
  await prisma.melodyNote.deleteMany();
  await prisma.difficultPart.deleteMany();
  await prisma.songSection.deleteMany();
  await prisma.practiceSession.deleteMany();
  await prisma.processingStage.deleteMany();
  await prisma.processingJob.deleteMany();
  await prisma.audioAsset.deleteMany();
  await prisma.sourceReference.deleteMany();
  await prisma.song.deleteMany();
}
