-- CreateTable
CREATE TABLE "developer_facebook_auth_data" (
    "id" SERIAL NOT NULL,
    "developer_id" INTEGER NOT NULL,
    "facebook_page_id" TEXT NOT NULL,
    "page_access_token" TEXT NOT NULL,
    "last_posted_at" TIMESTAMP(3),

    CONSTRAINT "developer_facebook_auth_data_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "developer_facebook_auth_data_developer_id_key" ON "developer_facebook_auth_data"("developer_id");

-- AddForeignKey
ALTER TABLE "developer_facebook_auth_data" ADD CONSTRAINT "developer_facebook_auth_data_developer_id_fkey" FOREIGN KEY ("developer_id") REFERENCES "developers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
