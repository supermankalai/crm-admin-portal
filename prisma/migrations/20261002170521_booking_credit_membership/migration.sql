-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "creditMembershipId" TEXT;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_gymId_creditMembershipId_fkey" FOREIGN KEY ("gymId", "creditMembershipId") REFERENCES "Membership"("gymId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
