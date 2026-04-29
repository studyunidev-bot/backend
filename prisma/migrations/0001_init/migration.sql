-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'STAFF', 'CHECKIN', 'VIEWER', 'ADMIN', 'SUPERADMIN');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('DRAFT', 'REGISTERED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExamRound" AS ENUM ('MORNING', 'AFTERNOON');

-- CreateEnum
CREATE TYPE "EnrollmentSourceType" AS ENUM ('ONSITE_EXCEL', 'SIMULATED_EXCEL', 'MANUAL', 'API');

-- CreateEnum
CREATE TYPE "CheckInStatus" AS ENUM ('SUCCESS', 'DUPLICATE', 'REJECTED');

-- CreateEnum
CREATE TYPE "SystemKey" AS ENUM ('GENERAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "fullName" TEXT,
    "role" "Role" NOT NULL DEFAULT 'STAFF',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "nationalId" TEXT NOT NULL,
    "prefix" TEXT,
    "firstNameTh" TEXT NOT NULL,
    "lastNameTh" TEXT NOT NULL,
    "firstNameEn" TEXT,
    "lastNameEn" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "schoolName" TEXT,
    "province" TEXT,
    "birthDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportFile" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "sourceType" "EnrollmentSourceType" NOT NULL,
    "academicYear" INTEGER,
    "checksum" TEXT,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "headerSnapshot" JSONB,
    "errorSnapshot" JSONB,

    CONSTRAINT "ImportFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamLocation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "province" TEXT,
    "address" TEXT,
    "seatCapacity" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "importedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "academicYear" INTEGER NOT NULL,
    "examRound" "ExamRound" NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'REGISTERED',
    "sourceType" "EnrollmentSourceType" NOT NULL,
    "barcode" TEXT NOT NULL,
    "registrationStartAt" TIMESTAMP(3),
    "registrationEndAt" TIMESTAMP(3),
    "registeredAt" TIMESTAMP(3),
    "notes" TEXT,
    "examLocationId" TEXT,
    "onsiteImportFileId" TEXT,
    "simulatedImportFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Score" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "tgat" DECIMAL(8,2),
    "tgat1" DECIMAL(8,2),
    "tgat2" DECIMAL(8,2),
    "tgat3" DECIMAL(8,2),
    "rankingOverall" INTEGER,
    "rankingLocation" INTEGER,
    "percentile" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Score_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckInSession" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "academicYear" INTEGER NOT NULL,
    "examRound" "ExamRound" NOT NULL,
    "examLocationId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdById" TEXT,

    CONSTRAINT "CheckInSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "status" "CheckInStatus" NOT NULL DEFAULT 'SUCCESS',
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceId" TEXT,
    "scannerUserId" TEXT,
    "note" TEXT,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "key" "SystemKey" NOT NULL DEFAULT 'GENERAL',
    "googleDriveLink" TEXT,
    "facebookLink" TEXT,
    "lineLink" TEXT,
    "isUserPortalOpen" BOOLEAN NOT NULL DEFAULT true,
    "userPortalOpensAt" TIMESTAMP(3),
    "userPortalClosesAt" TIMESTAMP(3),
    "isCheckInOpen" BOOLEAN NOT NULL DEFAULT true,
    "announcement" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Student_nationalId_key" ON "Student"("nationalId");

-- CreateIndex
CREATE INDEX "Student_lastNameTh_firstNameTh_idx" ON "Student"("lastNameTh", "firstNameTh");

-- CreateIndex
CREATE INDEX "Student_phone_idx" ON "Student"("phone");

-- CreateIndex
CREATE INDEX "ImportFile_sourceType_academicYear_idx" ON "ImportFile"("sourceType", "academicYear");

-- CreateIndex
CREATE INDEX "ImportFile_uploadedAt_idx" ON "ImportFile"("uploadedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExamLocation_code_key" ON "ExamLocation"("code");

-- CreateIndex
CREATE INDEX "ExamLocation_province_idx" ON "ExamLocation"("province");

-- CreateIndex
CREATE INDEX "ExamLocation_active_idx" ON "ExamLocation"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_barcode_key" ON "Enrollment"("barcode");

-- CreateIndex
CREATE INDEX "Enrollment_academicYear_examRound_idx" ON "Enrollment"("academicYear", "examRound");

-- CreateIndex
CREATE INDEX "Enrollment_examLocationId_idx" ON "Enrollment"("examLocationId");

-- CreateIndex
CREATE INDEX "Enrollment_status_idx" ON "Enrollment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_studentId_academicYear_examRound_key" ON "Enrollment"("studentId", "academicYear", "examRound");

-- CreateIndex
CREATE UNIQUE INDEX "Score_enrollmentId_key" ON "Score"("enrollmentId");

-- CreateIndex
CREATE INDEX "Score_rankingOverall_idx" ON "Score"("rankingOverall");

-- CreateIndex
CREATE INDEX "Score_rankingLocation_idx" ON "Score"("rankingLocation");

-- CreateIndex
CREATE INDEX "CheckInSession_isActive_academicYear_examRound_idx" ON "CheckInSession"("isActive", "academicYear", "examRound");

-- CreateIndex
CREATE INDEX "CheckInSession_examLocationId_idx" ON "CheckInSession"("examLocationId");

-- CreateIndex
CREATE INDEX "CheckIn_barcode_idx" ON "CheckIn"("barcode");

-- CreateIndex
CREATE INDEX "CheckIn_scannedAt_idx" ON "CheckIn"("scannedAt");

-- CreateIndex
CREATE INDEX "CheckIn_deviceId_idx" ON "CheckIn"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckIn_enrollmentId_sessionId_key" ON "CheckIn"("enrollmentId", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_key_key" ON "SystemSetting"("key");

-- AddForeignKey
ALTER TABLE "ImportFile" ADD CONSTRAINT "ImportFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamLocation" ADD CONSTRAINT "ExamLocation_importedFromId_fkey" FOREIGN KEY ("importedFromId") REFERENCES "ImportFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_examLocationId_fkey" FOREIGN KEY ("examLocationId") REFERENCES "ExamLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_onsiteImportFileId_fkey" FOREIGN KEY ("onsiteImportFileId") REFERENCES "ImportFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_simulatedImportFileId_fkey" FOREIGN KEY ("simulatedImportFileId") REFERENCES "ImportFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Score" ADD CONSTRAINT "Score_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInSession" ADD CONSTRAINT "CheckInSession_examLocationId_fkey" FOREIGN KEY ("examLocationId") REFERENCES "ExamLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInSession" ADD CONSTRAINT "CheckInSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CheckInSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_scannerUserId_fkey" FOREIGN KEY ("scannerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemSetting" ADD CONSTRAINT "SystemSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

