-- AlterTable
ALTER TABLE "Score" ADD COLUMN     "rankingLocationTgat1" INTEGER,
ADD COLUMN     "rankingLocationTgat2" INTEGER,
ADD COLUMN     "rankingLocationTgat3" INTEGER,
ADD COLUMN     "rankingOverallTgat1" INTEGER,
ADD COLUMN     "rankingOverallTgat2" INTEGER,
ADD COLUMN     "rankingOverallTgat3" INTEGER,
ALTER COLUMN "tgat" SET DATA TYPE DECIMAL(10,4),
ALTER COLUMN "tgat1" SET DATA TYPE DECIMAL(10,4),
ALTER COLUMN "tgat2" SET DATA TYPE DECIMAL(10,4),
ALTER COLUMN "tgat3" SET DATA TYPE DECIMAL(10,4);

-- CreateIndex
CREATE INDEX "Score_rankingOverallTgat1_idx" ON "Score"("rankingOverallTgat1");

-- CreateIndex
CREATE INDEX "Score_rankingLocationTgat1_idx" ON "Score"("rankingLocationTgat1");

-- CreateIndex
CREATE INDEX "Score_rankingOverallTgat2_idx" ON "Score"("rankingOverallTgat2");

-- CreateIndex
CREATE INDEX "Score_rankingLocationTgat2_idx" ON "Score"("rankingLocationTgat2");

-- CreateIndex
CREATE INDEX "Score_rankingOverallTgat3_idx" ON "Score"("rankingOverallTgat3");

-- CreateIndex
CREATE INDEX "Score_rankingLocationTgat3_idx" ON "Score"("rankingLocationTgat3");
