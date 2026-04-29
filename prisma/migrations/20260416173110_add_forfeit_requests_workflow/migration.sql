-- CreateEnum
CREATE TYPE "ForfeitRequestStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "ForfeitRequest" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "status" "ForfeitRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForfeitRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ForfeitRequest_enrollmentId_key" ON "ForfeitRequest"("enrollmentId");

-- CreateIndex
CREATE INDEX "ForfeitRequest_status_idx" ON "ForfeitRequest"("status");

-- CreateIndex
CREATE INDEX "ForfeitRequest_submittedAt_idx" ON "ForfeitRequest"("submittedAt");

-- AddForeignKey
ALTER TABLE "ForfeitRequest" ADD CONSTRAINT "ForfeitRequest_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForfeitRequest" ADD CONSTRAINT "ForfeitRequest_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
