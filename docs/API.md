# lab-asset-hub 接口契约（冻结版 v1）

本文件是并行开发的唯一接口契约。**改动契约必须先改本文件并由调度方确认**，否则会导致四个并行子任务互相踩踏。

## 0. 通用约定

- 服务默认监听 `http://<host>:4000`，所有业务端点在 `/api` 下。
- 鉴权：`Authorization: Bearer <jwt>`。JWT 载荷 `{ sub, phone, name, role }`，有效期 7 天。
  - 签名/校验由 `server/src/plugins/auth.ts` 提供：`signToken`、`requireAuth`、`requireAdmin`、`currentUser`、`isAdmin`、`canEditAsset`、`requestIp`。
  - 受保护路由必须用 `{ preHandler: requireAuth }` 或 `{ preHandler: requireAdmin }`。
- 响应：成功直接返回资源 JSON（**不要包信封**）；列表统一 `{ items, total, page, pageSize }`。
- 错误：`{ "error": { "code", "message", "details"? } }`，抛 `AppError`（`server/src/lib/errors.ts`）即可，全局处理器已就位。
  - 码表：`UNAUTHENTICATED`(401) `FORBIDDEN`(403) `NOT_FOUND`(404) `VALIDATION`(422) `CONFLICT`(409) `REPORT_LOCKED`(409) `INTERNAL`(500)。
- 入参校验：一律用 `@lab/shared` 里的 zod schema `parse`，失败抛 `AppError.validation('...', err.issues)`。
- 时间：DTO 中的时间字段一律 ISO 字符串（`toISOString()`）。
- 分页默认 `page=1`、`pageSize=20`（上限 200）。
- 审计：写操作必须调用 `recordAudit({ actor, action, entityType, entityId, before, after, ip })`（`server/src/lib/audit.ts`），失败不阻断主流程。
- 相对导入带 `.js` 后缀（ESM 约定），例如 `import { prisma } from './lib/prisma.js'`。
- 密码哈希统一 `bcryptjs`、cost 10：`await bcrypt.hash(password, 10)`。
- 文件：`server/src/lib/storage.ts` 已提供上传落盘与鉴权下载，业务模块**不要再写上传逻辑**，直接调用 `saveUpload(file, { usage, uploaderId })`。

## 1. 归属边界（谁写哪里）

| 子任务 | 后端目录 | 前端目录 | 端点前缀 |
|---|---|---|---|
| A 账号与权限 | `server/src/modules/users/**` | `desktop/src/pages/{LoginPage,RegisterPage,AdminUsersPage}.tsx` | `/api/auth/*` `/api/users* ` |
| B 资产台账 | `server/src/modules/assets/**` | `desktop/src/pages/AssetsPage.tsx` `desktop/src/pages/assets/**` | `/api/assets* ` `/api/borrows* ` `/api/inventory/* ` `/api/audit` |
| C 图文周报 | `server/src/modules/reports/**` | `desktop/src/pages/{ReportsPage,ReportEditorPage,ReviewPage,HomePage}.tsx` `desktop/src/pages/reports/**` | `/api/reports* ` |
| D 打包与部署 | `electron-builder.yml` `deploy/**` `scripts/**` `server/prisma/seed.ts` `docs/部署与使用.md` `README.md` | — | — |

公共文件（`server/src/app.ts`、`lib/**`、`plugins/**`、`desktop/src/{App.tsx,api/**,auth/**,ui/**,main.tsx,styles.css}`、`shared/**`、`docs/API.md`）**由调度方维护，子任务不得修改**；确实需要改动时在报告里 hand_back 说明。

## 2. 认证与用户（子任务 A）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/auth/register` | 公开 | body `registerSchema`；创建 `status=PENDING`、`role=MEMBER` 的账号；返回 `201 { user: UserDTO }`；手机号已存在 → `CONFLICT`；审计 `REGISTER/USER` |
| POST | `/api/auth/login` | 公开 | body `loginSchema`；成功 `{ token, user: UserDTO }`；密码错 `UNAUTHENTICATED '手机号或密码不正确'`；`PENDING` → `FORBIDDEN '账号待管理员审批'`；`DISABLED` → `FORBIDDEN '账号已被禁用'`；审计 `LOGIN/USER` |
| GET | `/api/auth/me` | 登录 | 返回当前 `UserDTO`（`status` 非 ACTIVE 时 `FORBIDDEN`） |
| GET | `/api/users?status=&q=&page=&pageSize=` | 管理员 | `ListResult<UserDTO>`；`q` 匹配姓名/手机号 |
| POST | `/api/users` | 管理员 | body `createUserSchema`，可指定 `role/status`（默认 ACTIVE） |
| PATCH | `/api/users/:id` | 管理员 | body `updateUserSchema`；不得把最后一个 ACTIVE 管理员降级或禁用 → `CONFLICT`；审计 `UPDATE/USER`（before/after 不含 passwordHash） |
| POST | `/api/users/:id/reset-password` | 管理员 | body `resetPasswordSchema`；审计 `UPDATE/USER` |

前端要求：登录页（手机号+密码，含「待审批」态提示）、注册页（手机号/密码/姓名/邮箱可选）、管理员用户管理页（列表 + 审批通过/禁用/改角色/重置密码）。**第一个管理员由 seed 脚本创建**（见 `docs/部署与使用.md`），注册页不可自封管理员。

## 3. 资产台账（子任务 B）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/assets` | 登录 | query `assetQuerySchema`；返回 `ListResult<AssetDTO>`；`q` 匹配 code/name/model/serialNo/remark；`category/status/ownerId` 精确过滤；默认 `sortBy=updatedAt&sortDir=desc` |
| GET | `/api/assets/:id` | 登录 | `AssetDTO`（含 attachments、activeBorrow） |
| POST | `/api/assets` | 登录 | body `assetInputSchema`；成员只能把 `ownerId` 设为自己（省略则默认自己），设他人 → `FORBIDDEN`；`code` 重复 → `CONFLICT`；审计 `CREATE/ASSET` |
| PATCH | `/api/assets/:id` | 行级 | body `assetPatchSchema`；`canEditAsset` 为假 → `FORBIDDEN '只能修改自己负责的资产'`；成员不得改 `ownerId`；审计 `UPDATE/ASSET`（before/after 只放变更字段） |
| DELETE | `/api/assets/:id` | 管理员 | 审计 `DELETE/ASSET` |
| GET | `/api/assets/export` | 登录 | query 同列表（不分页）；返回 xlsx 流，`Content-Type`=xlsx，`Content-Disposition: attachment; filename*=UTF-8''资产台账-<yyyyMMdd>.xlsx` |
| GET | `/api/assets/template` | 登录 | 返回导入模板 xlsx（表头 + 一行示例） |
| POST | `/api/assets/import` | 管理员 | multipart 字段 `file`；按 `code` upsert；返回 `{ created, updated, skipped, errors: [{ row, message }] }`；审计 `IMPORT/ASSET` |
| POST | `/api/assets/:id/attachments` | 行级 | multipart `file` + 字段 `kind`（`ATTACHMENT_KINDS`）；返回 `AssetAttachmentDTO` 201 |
| DELETE | `/api/assets/:id/attachments/:attachmentId` | 行级 | 返回 `{ ok: true }` |
| POST | `/api/assets/:id/borrow` | 登录 | body `borrowInputSchema`；已借出 → `CONFLICT '该资产已在借用中'`；成功把资产 `status` 置 `BORROWED`；审计 `BORROW/ASSET` |
| POST | `/api/assets/:id/return` | 登录 | 关闭当前未归还记录，资产 `status` 回 `IN_USE`；无未归还记录 → `CONFLICT`；审计 `RETURN/ASSET` |
| GET | `/api/borrows?assetId=&borrowerId=&active=true&page=` | 登录 | `ListResult<BorrowDTO>` |
| POST | `/api/inventory/batches` | 管理员 | body `inventoryCreateSchema`（可选 `category/ownerId` 缩小范围）；为范围内全部资产生成 `InventoryItem`（`expectedStatus=资产当前 status`、`result=PENDING`）；审计 `CREATE/INVENTORY` |
| GET | `/api/inventory/batches` | 登录 | `ListResult<InventoryBatchDTO>`（含 total/checked/mismatched 统计） |
| GET | `/api/inventory/batches/:id` | 登录 | `InventoryBatchDTO` + `items` |
| PATCH | `/api/inventory/items/:itemId` | 管理员 | body `inventoryCheckSchema`；核算 `result`：`PRESENT`→`MATCH`，`MISSING`→`MISSING`，`DAMAGED/UNKNOWN`→`MISMATCH` |
| POST | `/api/inventory/batches/:id/close` | 管理员 | 置 `closedAt`；审计 `UPDATE/INVENTORY` |
| GET | `/api/inventory/batches/:id/export` | 登录 | 差异表 xlsx（仅 `result != MATCH` 的行） |
| GET | `/api/audit?entityType=&entityId=&userId=&from=&to=&page=` | 管理员 | `ListResult<AuditDTO>`，按 `createdAt desc` |

前端要求（单页 + 抽屉/弹窗，不跳页）：筛选栏（关键词/类别/状态/责任人）、分页表格、行内编辑或抽屉表单、导入导出按钮、附件上传与预览（图片缩略图、PDF 打开）、借用/归还、盘点入口、管理员可见「审计日志」与「删除」。金额展示用 `formatMoney`。图片地址必须用 `mediaUrl()`（带 token）。

## 4. 周报（子任务 C）

周次用 ISO 周键 `YYYY-Www`（`isoWeekKey`），周期区间为本地时间周一 00:00 → 周日 23:59:59。**一人一周一份**（DB 唯一约束 `authorId + periodStart`）。

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/reports/summary` | 登录 | `ReportSummaryDTO`：`{ week, mine, isOverdue, admin }`；`isOverdue`=本周已过周日 18:00 且我的报告未提交；`admin` 仅管理员有值，含 `missing`（ACTIVE 且本周无 SUBMITTED/APPROVED 的成员）与 `pendingReview`（SUBMITTED 总数） |
| GET | `/api/reports?status=&authorId=&week=&page=` | 登录 | 成员只能看自己的（自动加 `authorId=自己`）；管理员可看全部；`ListResult<ReportDTO>` |
| GET | `/api/reports/:id` | 本人/管理员 | `ReportDTO`（含 comments） |
| POST | `/api/reports` | 登录 | body `reportSaveSchema`（`week` 省略=本周）；按 `(authorId, periodStart)` upsert；已有 SUBMITTED/APPROVED → `REPORT_LOCKED`；返回 201 `ReportDTO` |
| PATCH | `/api/reports/:id` | 本人 | 仅作者且状态 `DRAFT|REJECTED`，否则 `REPORT_LOCKED '周报已提交，需管理员退回后才能修改'` |
| POST | `/api/reports/:id/submit` | 本人 | `DRAFT|REJECTED` → `SUBMITTED`（置 `submittedAt`，清空上一轮审核结论）；空正文 → `VALIDATION`；审计 `SUBMIT/REPORT` |
| POST | `/api/reports/:id/review` | 管理员 | body `reportReviewSchema`；`APPROVED|REJECTED` 并写 `reviewedById/reviewedAt/reviewComment`；非 SUBMITTED 状态 → `CONFLICT`；`REJECTED` 后作者可再编辑重提；审计 `REVIEW/REPORT` |
| POST | `/api/reports/:id/comments` | 本人/管理员 | body `commentInputSchema` → `ReportCommentDTO` 201 |
| GET | `/api/reports/:id/export.docx` | 本人/管理员 | 用 `docx` 生成 Word（标题/作者/周次/状态/正文段落/图片），返回文件流 |

正文富文本格式约定：**图片以 `<img src="media:<mediaId>">` 存储**（上传走 `POST /api/media`，字段 `file` + `usage=REPORT`），渲染时用 `resolveMediaHtml()` 换成带 token 的真实地址。禁止把 base64 图片写进 `contentHtml`。

前端要求：
- `HomePage`：本周周报状态卡（未写/草稿/已提交/已通过/已退回）+ **未交标红**（`isOverdue`）+ 管理员区（未交名单、待审阅数）+ 资产/周报入口。
- `ReportsPage`：我的周报列表（按周倒序）+ 新建/继续编辑；管理员多一个 Tab 显示全组周报与状态筛选。
- `ReportEditorPage`：TipTap 富文本（标题、粗斜体、列表、引用、撤销重做、粘贴/拖拽上传图片），自动保存草稿（防抖 2s），提交确认，被退回时显示审核意见，评论串；导出 Word 调 `/export.docx`，导出 PDF 用 `window.desktop.printPdf({ html })`。
- `ReviewPage`：管理员审阅（列表 + 预览 + 通过/退回 + 批注）。

## 4A. 周报模版与提交截止（v2 新增）

### 数据模型（已落地，见 `server/prisma/schema.prisma`）

- `ReportTemplate`：`name, version, sectionsJson, sourceName, sourceFormat(docx|md), rawPath, isActive, createdById`
  - `sectionsJson` = `[{ key, title, hint }]`，`key` 为 `s1..sn`（顺序稳定）
- `Report` 新增：`sectionsJson`（`[{ key, title, hint, contentHtml }]`）、`templateId`、`templateSnapshotJson`（提交时快照 `{ name, sections:[{key,title,hint}] }`）、`late`
- `DeadlineOverride`：`week(unique), deadline, reason`
- `AppSetting`：键值对；截止规则存 `report.deadline.weekday`（1=周一…7=周日，默认 7）与 `report.deadline.time`（`HH:mm`，默认 `18:00`）

### 模版端点

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/templates` | 登录 | `ListResult<ReportTemplateDTO>`，含 `reportCount`（被多少份周报引用），按 `createdAt desc` |
| GET | `/api/templates/active` | 登录 | 当前生效模版 `ReportTemplateDTO`；无则返回 `null`（HTTP 200） |
| POST | `/api/templates` | 管理员 | multipart：`file`（.docx/.md/.markdown）+ 可选 `name`、`activate`（`1` 表示立即生效）。解析小节 → 201 `ReportTemplateDTO`；解析失败 → 422 并说明原因 |
| PATCH | `/api/templates/:id/activate` | 管理员 | 置为生效模版，同时把其他模版 `isActive=false`；返回 `ReportTemplateDTO` |
| DELETE | `/api/templates/:id` | 管理员 | 删除模版；已被周报引用时**允许删除**，历史周报靠 `templateSnapshotJson` 展示；返回 `{ ok: true }` |

**解析规则（必须按此实现，前端与测试都依赖）**

- `.docx`：docx 是 zip，读 `word/document.xml` **与 `word/styles.xml`**；段落为标题的条件（按优先级取最小级别）：
  1. `w:pStyle w:val` 指向的样式**名称**命中 `/^(heading|标题)\s*[1-9]$/i`（样式名从 `styles.xml` 的 `w:styleId → w:name` 映射查出；
     中文版 Word 常把「标题 1/2/3」的 `styleId` 直接记成 `1/2/3`，此时靠这个映射识别）；
  2. 没有 `styles.xml` 时，数字 `styleId` `1/2/3` 兜底视为标题 1/2/3；
  3. 段落带 `w:outlineLvl w:val=N` 时级别为 `N+1`（≤3 视为标题）。
  **小节层级的选取**：统计各标题级别出现次数，取「出现 ≥2 次的最浅级别」；若没有任何级别出现 ≥2 次则取最浅级别。
  这样「标题 1 只出现一次（文档标题）+ 标题 2 出现多次（真正栏目）」会正确取标题 2（真实周报即此结构）。
  非小节层级的标题文本降级为该小节的 `hint`；标题之间的非空段落文本（纯文本、去标签、跳过纯数字/标点碎片）拼接为 `hint`（截断 200 字）
- `.md`：`^#{1,3}\s+标题` 为小节，其后到下一标题之间的正文为 `hint`
- 一个小节都没识别到 → `VALIDATION`：「未在文件中识别到小节标题，请使用 Word 的标题 1/2/3 样式或 Markdown 的 ## 标题」
- 小节数必须 1–30，单节标题 ≤120 字
- 不上传原始文件也应把原文落盘（`rawPath`），便于溯源；体积上限 20MB，复用 `lib/storage.ts`

### 截止时间端点

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/settings/report-deadline?week=` | 登录 | `DeadlineDTO`：`{ week, deadline, source: RULE|OVERRIDE, weekday, time, overrideReason }`；`week` 省略=当前 ISO 周 |
| PATCH | `/api/settings/report-deadline` | 管理员 | body `deadlineRuleSchema`（`weekday` 1–7、`time` HH:mm）→ 写 AppSetting，返回 `{ weekday, time }` |
| PUT | `/api/settings/report-deadline/overrides/:week` | 管理员 | body `deadlineOverrideSchema`（`deadline` ISO、`reason?`）→ upsert 覆盖，返回 `DeadlineDTO` |
| DELETE | `/api/settings/report-deadline/overrides/:week` | 管理员 | 取消该周覆盖 → `{ ok: true }` |
| GET | `/api/settings/report-deadline/overrides?from=&to=` | 管理员 | `ListResult<{ week, deadline, reason }>`，按 `week desc` |

**计算规则**：`deadline = 该 ISO 周的周一 00:00 + (weekday-1) 天 + time`；有覆盖则直接用覆盖值（`source=OVERRIDE`）。全部按本地时区。

### 周报端点的变化

- `POST /api/reports`、`PATCH /api/reports/:id`：接受 `sections: [{ key, title, contentHtml }]`（`reportSectionInputSchema`）。保存时把当前生效模版的小节结构写进 `templateSnapshotJson`（仅当为空时写入，提交后不再变），`contentHtml` 仍保留（旧版自由正文兼容，`sections` 存在时可为空）
- `POST /api/reports/:id/submit` 增加校验：**若存在生效模版，则每个小节 `contentHtml` 去标签后必须非空**，否则 `VALIDATION`：「《小节标题》未填写」；同时若提交时刻 > 本轮截止时间，置 `late=true`（**不阻断提交**，用户已选定「过期只提醒」）
- `GET /api/reports/summary`：新增 `deadline: DeadlineDTO`；`isOverdue` 改为 `now > deadline && 本周未提交或未通过`（不再硬编码周日 18:00）
- `ReportDTO` 新增 `sections`、`templateSnapshot`、`late`；`sections` 为空数组时表示旧版自由正文周报，前端按 `contentHtml` 渲染

### 前端要求

- 管理员新增「模版与截止」页（`/admin/templates`，路由与侧栏由调度方在 `App.tsx` 加好）：上传模版、列出模版（名称/小节数/是否生效/引用数）、预览小节、设为生效、删除；截止规则（周几下拉 + 时分）与当前周截止时间展示；单周覆盖的增删（输入周次或从列表选）
- 周报编辑器：按 `/api/templates/active` 的小节逐节渲染富文本（复用 `RichEditor`，注意每节独立实例与自动保存节流）、显示小节 `hint`、显示提交截止时间与「已过期」提示；`sections` 为空的旧周报仍按原样渲染 `contentHtml`
- 工作台：显示本周截止时间与来源（规则/覆盖），过期时标红；管理员区可见「第 X 周截止：MM-DD HH:mm（覆盖：原因）」

## 5. 媒体（调度方已实现，子任务只调用）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/media` | multipart：`file`，可选字段 `usage`(ASSET/REPORT)。返回 `MediaDTO` 201 |
| GET | `/api/media/:id` | 下载/预览（需登录；`?token=<jwt>` 可用于 `<img>`） |
| DELETE | `/api/media/:id` | 上传者或管理员 |

## 6. 测试要求

- 后端：`server/src/modules/<x>/*.test.ts` 用 vitest + `buildApp()` + `app.inject()`，覆盖权限拒绝路径（成员改他人资产 403、成员看他人周报 403、已提交周报 PATCH 409、最后一个管理员不可禁用 409）。
- 前端：不强制单测，但必须在报告里给出可复现的手工验证步骤。