-- DropIndex
DROP INDEX "Enrollment_studentId_academicYear_examRound_key";

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_studentId_academicYear_examRound_sourceType_key"
ON "Enrollment"("studentId", "academicYear", "examRound", "sourceType");