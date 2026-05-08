-- CreateEnum
CREATE TYPE "OfferIndexType" AS ENUM ('CASHBACK', 'EXCLUSIVE', 'LOYALTY');

-- CreateTable
CREATE TABLE "Outlet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "merchantId" TEXT NOT NULL,
    "reviewId" TEXT,

    CONSTRAINT "Outlet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaybillOrTill" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "accountNumber" TEXT,
    "type" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "reviewId" TEXT,

    CONSTRAINT "PaybillOrTill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "category" TEXT NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashbackConfiguration" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "eligibleCustomerTypes" TEXT[],
    "merchantId" TEXT NOT NULL,
    "reviewId" TEXT,
    "netCashbackBudget" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "usedCashbackBudget" DECIMAL(65,30) NOT NULL DEFAULT 0.0,

    CONSTRAINT "CashbackConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashbackConfigurationTier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cashbackPercentage" DECIMAL(65,30),
    "minSpend" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "cashbackConfigurationId" TEXT NOT NULL,
    "reviewId" TEXT,

    CONSTRAINT "CashbackConfigurationTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExclusiveOffer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "eligibleCustomerTypes" TEXT[],
    "merchantId" TEXT,
    "reviewId" TEXT,
    "netOfferBudget" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "usedOfferBudget" DECIMAL(65,30) NOT NULL DEFAULT 0.0,

    CONSTRAINT "ExclusiveOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExclusiveOfferFeedTimeline" (
    "id" TEXT NOT NULL,
    "exclusiveOfferId" TEXT NOT NULL,
    "customerTypeId" TEXT NOT NULL,

    CONSTRAINT "ExclusiveOfferFeedTimeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyProgram" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "merchantId" TEXT,
    "reviewId" TEXT,
    "pointsUsedInPeriod" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "pointsIssuedLimit" DECIMAL(65,30),

    CONSTRAINT "LoyaltyProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyTier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "minCustomerType" TEXT NOT NULL,
    "multiplier" DECIMAL(65,30) NOT NULL DEFAULT 1.0,
    "loyaltyProgramId" TEXT NOT NULL,
    "reviewId" TEXT,

    CONSTRAINT "LoyaltyTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantLoyaltyReward" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "loyaltyProgramId" TEXT NOT NULL,
    "reviewId" TEXT,

    CONSTRAINT "MerchantLoyaltyReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "loyaltyProgramId" TEXT NOT NULL,
    "reviewId" TEXT,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerType" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,

    CONSTRAINT "CustomerType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferIndex" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "offerType" "OfferIndexType" NOT NULL,
    "offerId" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "isAvailable" BOOLEAN NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "maxCashbackPercentage" DECIMAL(65,30),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfferIndex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_OutletPaybillOrTill" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_OutletPaybillOrTill_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_CategoryToMerchant" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CategoryToMerchant_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_OutletCashback" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_OutletCashback_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_OutletExclusive" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_OutletExclusive_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Outlet_reviewId_key" ON "Outlet"("reviewId");

-- CreateIndex
CREATE INDEX "Outlet_merchantId_isActive_idx" ON "Outlet"("merchantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PaybillOrTill_reviewId_key" ON "PaybillOrTill"("reviewId");

-- CreateIndex
CREATE INDEX "Merchant_status_category_idx" ON "Merchant"("status", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CashbackConfiguration_reviewId_key" ON "CashbackConfiguration"("reviewId");

-- CreateIndex
CREATE INDEX "CashbackConfiguration_merchantId_isActive_deletedAt_idx" ON "CashbackConfiguration"("merchantId", "isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "CashbackConfiguration_startDate_endDate_idx" ON "CashbackConfiguration"("startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "CashbackConfigurationTier_reviewId_key" ON "CashbackConfigurationTier"("reviewId");

-- CreateIndex
CREATE INDEX "CashbackConfigurationTier_cashbackConfigurationId_isActive__idx" ON "CashbackConfigurationTier"("cashbackConfigurationId", "isActive", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExclusiveOffer_reviewId_key" ON "ExclusiveOffer"("reviewId");

-- CreateIndex
CREATE INDEX "ExclusiveOffer_merchantId_isActive_idx" ON "ExclusiveOffer"("merchantId", "isActive");

-- CreateIndex
CREATE INDEX "ExclusiveOffer_startDate_endDate_idx" ON "ExclusiveOffer"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "ExclusiveOfferFeedTimeline_customerTypeId_idx" ON "ExclusiveOfferFeedTimeline"("customerTypeId");

-- CreateIndex
CREATE INDEX "ExclusiveOfferFeedTimeline_exclusiveOfferId_idx" ON "ExclusiveOfferFeedTimeline"("exclusiveOfferId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyProgram_merchantId_key" ON "LoyaltyProgram"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyProgram_reviewId_key" ON "LoyaltyProgram"("reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyTier_reviewId_key" ON "LoyaltyTier"("reviewId");

-- CreateIndex
CREATE INDEX "LoyaltyTier_loyaltyProgramId_isActive_deletedAt_idx" ON "LoyaltyTier"("loyaltyProgramId", "isActive", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantLoyaltyReward_reviewId_key" ON "MerchantLoyaltyReward"("reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_reviewId_key" ON "Campaign"("reviewId");

-- CreateIndex
CREATE INDEX "CustomerType_userId_idx" ON "CustomerType"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerType_userId_merchantId_key" ON "CustomerType"("userId", "merchantId");

-- CreateIndex
CREATE INDEX "OfferIndex_audience_isAvailable_outletId_idx" ON "OfferIndex"("audience", "isAvailable", "outletId");

-- CreateIndex
CREATE INDEX "OfferIndex_merchantId_offerType_isAvailable_idx" ON "OfferIndex"("merchantId", "offerType", "isAvailable");

-- CreateIndex
CREATE INDEX "OfferIndex_endDate_isAvailable_idx" ON "OfferIndex"("endDate", "isAvailable");

-- CreateIndex
CREATE INDEX "OfferIndex_startDate_isAvailable_idx" ON "OfferIndex"("startDate", "isAvailable");

-- CreateIndex
CREATE UNIQUE INDEX "OfferIndex_outletId_offerType_offerId_audience_key" ON "OfferIndex"("outletId", "offerType", "offerId", "audience");

-- CreateIndex
CREATE INDEX "_OutletPaybillOrTill_B_index" ON "_OutletPaybillOrTill"("B");

-- CreateIndex
CREATE INDEX "_CategoryToMerchant_B_index" ON "_CategoryToMerchant"("B");

-- CreateIndex
CREATE INDEX "_OutletCashback_B_index" ON "_OutletCashback"("B");

-- CreateIndex
CREATE INDEX "_OutletExclusive_B_index" ON "_OutletExclusive"("B");

-- AddForeignKey
ALTER TABLE "Outlet" ADD CONSTRAINT "Outlet_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outlet" ADD CONSTRAINT "Outlet_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaybillOrTill" ADD CONSTRAINT "PaybillOrTill_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashbackConfiguration" ADD CONSTRAINT "CashbackConfiguration_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashbackConfiguration" ADD CONSTRAINT "CashbackConfiguration_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashbackConfigurationTier" ADD CONSTRAINT "CashbackConfigurationTier_cashbackConfigurationId_fkey" FOREIGN KEY ("cashbackConfigurationId") REFERENCES "CashbackConfiguration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashbackConfigurationTier" ADD CONSTRAINT "CashbackConfigurationTier_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExclusiveOffer" ADD CONSTRAINT "ExclusiveOffer_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExclusiveOffer" ADD CONSTRAINT "ExclusiveOffer_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExclusiveOfferFeedTimeline" ADD CONSTRAINT "ExclusiveOfferFeedTimeline_exclusiveOfferId_fkey" FOREIGN KEY ("exclusiveOfferId") REFERENCES "ExclusiveOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExclusiveOfferFeedTimeline" ADD CONSTRAINT "ExclusiveOfferFeedTimeline_customerTypeId_fkey" FOREIGN KEY ("customerTypeId") REFERENCES "CustomerType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyProgram" ADD CONSTRAINT "LoyaltyProgram_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyProgram" ADD CONSTRAINT "LoyaltyProgram_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTier" ADD CONSTRAINT "LoyaltyTier_loyaltyProgramId_fkey" FOREIGN KEY ("loyaltyProgramId") REFERENCES "LoyaltyProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTier" ADD CONSTRAINT "LoyaltyTier_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantLoyaltyReward" ADD CONSTRAINT "MerchantLoyaltyReward_loyaltyProgramId_fkey" FOREIGN KEY ("loyaltyProgramId") REFERENCES "LoyaltyProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantLoyaltyReward" ADD CONSTRAINT "MerchantLoyaltyReward_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_loyaltyProgramId_fkey" FOREIGN KEY ("loyaltyProgramId") REFERENCES "LoyaltyProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerType" ADD CONSTRAINT "CustomerType_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferIndex" ADD CONSTRAINT "OfferIndex_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OutletPaybillOrTill" ADD CONSTRAINT "_OutletPaybillOrTill_A_fkey" FOREIGN KEY ("A") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OutletPaybillOrTill" ADD CONSTRAINT "_OutletPaybillOrTill_B_fkey" FOREIGN KEY ("B") REFERENCES "PaybillOrTill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CategoryToMerchant" ADD CONSTRAINT "_CategoryToMerchant_A_fkey" FOREIGN KEY ("A") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CategoryToMerchant" ADD CONSTRAINT "_CategoryToMerchant_B_fkey" FOREIGN KEY ("B") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OutletCashback" ADD CONSTRAINT "_OutletCashback_A_fkey" FOREIGN KEY ("A") REFERENCES "CashbackConfiguration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OutletCashback" ADD CONSTRAINT "_OutletCashback_B_fkey" FOREIGN KEY ("B") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OutletExclusive" ADD CONSTRAINT "_OutletExclusive_A_fkey" FOREIGN KEY ("A") REFERENCES "ExclusiveOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OutletExclusive" ADD CONSTRAINT "_OutletExclusive_B_fkey" FOREIGN KEY ("B") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
