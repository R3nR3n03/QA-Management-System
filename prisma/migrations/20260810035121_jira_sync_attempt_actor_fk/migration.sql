-- AddForeignKey
ALTER TABLE "JiraSyncAttempt" ADD CONSTRAINT "JiraSyncAttempt_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
