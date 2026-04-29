-- AlterTable
ALTER TABLE "ExamLocation" ADD COLUMN     "eventDate" TIMESTAMP(3),
ADD COLUMN     "eventEndMinutes" INTEGER,
ADD COLUMN     "eventStartMinutes" INTEGER;
