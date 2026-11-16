-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "groupId" TEXT,
    CONSTRAINT "User_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Memo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "dueAt" DATETIME,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" DATETIME,
    "remindedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Memo_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'NOTE',
    "title" TEXT NOT NULL,
    "day" TEXT,
    "contentHtml" TEXT NOT NULL DEFAULT '',
    "plainText" TEXT NOT NULL DEFAULT '',
    "tagsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Note_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NoteLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT,
    "targetTitle" TEXT NOT NULL,
    CONSTRAINT "NoteLink_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Note" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NoteLink_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Note" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Media" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "usage" TEXT NOT NULL DEFAULT 'ASSET',
    "uploaderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Media_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "model" TEXT,
    "serialNo" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" REAL,
    "amount" REAL,
    "purchaseDate" DATETIME,
    "supplier" TEXT,
    "location" TEXT,
    "ownerId" TEXT,
    "groupId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_USE',
    "remark" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Asset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Asset_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Asset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssetAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PHOTO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssetAttachment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssetAttachment_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BorrowRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "borrowedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" DATETIME,
    "returnedAt" DATETIME,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BorrowRecord_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BorrowRecord_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    CONSTRAINT "InventoryBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "expectedStatus" TEXT NOT NULL,
    "expectedLocation" TEXT,
    "actualStatus" TEXT,
    "actualLocation" TEXT,
    "result" TEXT NOT NULL DEFAULT 'PENDING',
    "checkedById" TEXT,
    "checkedAt" DATETIME,
    "note" TEXT,
    CONSTRAINT "InventoryItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InventoryItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InventoryItem_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "ip" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "authorId" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "week" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "contentHtml" TEXT NOT NULL DEFAULT '',
    "sectionsJson" TEXT NOT NULL DEFAULT '[]',
    "templateId" TEXT,
    "templateSnapshotJson" TEXT,
    "late" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "submittedAt" DATETIME,
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "reviewComment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Report_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Report_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ReportTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Report_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReportTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sectionsJson" TEXT NOT NULL DEFAULT '[]',
    "sourceName" TEXT,
    "sourceFormat" TEXT NOT NULL DEFAULT 'docx',
    "rawPath" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeadlineOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "week" TEXT NOT NULL,
    "deadline" DATETIME NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ReportComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportComment_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReportComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "Memo_ownerId_done_idx" ON "Memo"("ownerId", "done");

-- CreateIndex
CREATE INDEX "Memo_ownerId_dueAt_idx" ON "Memo"("ownerId", "dueAt");

-- CreateIndex
CREATE INDEX "Note_ownerId_kind_idx" ON "Note"("ownerId", "kind");

-- CreateIndex
CREATE INDEX "Note_ownerId_updatedAt_idx" ON "Note"("ownerId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Note_ownerId_day_key" ON "Note"("ownerId", "day");

-- CreateIndex
CREATE INDEX "NoteLink_sourceId_idx" ON "NoteLink"("sourceId");

-- CreateIndex
CREATE INDEX "NoteLink_targetId_idx" ON "NoteLink"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "Group_name_key" ON "Group"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_code_key" ON "Asset"("code");

-- CreateIndex
CREATE INDEX "Asset_category_idx" ON "Asset"("category");

-- CreateIndex
CREATE INDEX "Asset_status_idx" ON "Asset"("status");

-- CreateIndex
CREATE INDEX "Asset_ownerId_idx" ON "Asset"("ownerId");

-- CreateIndex
CREATE INDEX "AssetAttachment_assetId_idx" ON "AssetAttachment"("assetId");

-- CreateIndex
CREATE INDEX "BorrowRecord_assetId_idx" ON "BorrowRecord"("assetId");

-- CreateIndex
CREATE INDEX "BorrowRecord_borrowerId_idx" ON "BorrowRecord"("borrowerId");

-- CreateIndex
CREATE INDEX "InventoryItem_batchId_idx" ON "InventoryItem"("batchId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Report_status_idx" ON "Report"("status");

-- CreateIndex
CREATE INDEX "Report_week_idx" ON "Report"("week");

-- CreateIndex
CREATE UNIQUE INDEX "Report_authorId_periodStart_key" ON "Report"("authorId", "periodStart");

-- CreateIndex
CREATE INDEX "ReportTemplate_isActive_idx" ON "ReportTemplate"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "DeadlineOverride_week_key" ON "DeadlineOverride"("week");

-- CreateIndex
CREATE INDEX "ReportComment_reportId_idx" ON "ReportComment"("reportId");

