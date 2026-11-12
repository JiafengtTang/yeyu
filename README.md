# 页屿 · Yeyu

内网自建的小型管理工具：一个应用同时管**登记类台账**和**周期性图文汇报**——台账记"有什么、归谁、去哪了"，汇报按模版逐节记录"这段时间做了什么"。一套服务端 + 一个桌面客户端即可跑起来，不依赖任何外部服务。

设计上不绑定具体行业：**台账的列是固定的**，**汇报的小节由管理员上传的模版决定**，所以实验室记录仪器、车间登记设备、行政组统计物料与周报，用的都是同一套东西。

- 服务端：Node.js 24 + Fastify 4 + Prisma 5 / **SQLite 单文件**（无需另装数据库），端口 4000。
- 客户端：Electron 33 + React 18 + Vite，Windows / macOS 免签名安装包。
- 形态：内网私有部署，账号由管理员审批；所有写操作落审计日志。

## 汇报模版与提交截止（以周报为例）

- **模版**：管理员在「模版与截止」页上传 `.docx` 或 `.md`，系统按 **Word 标题 1/2/3 样式**（或 Markdown 的 `##`）识别小节，小节之间的正文作为填写提示。上传后每人写周报时**按小节逐节填写**，缺任何一节都无法提交（会明确提示《小节名》未填写）。
- **截止时间**：全局规则「每周几 HH:mm」+ **单周覆盖**（放假顺延只改那一周，可写原因）。工作台与编辑器都会显示本轮截止时间及其来源（规则/覆盖）。
- **迟交**：过期后仍可提交，但会记 `late=true` 并在界面标「迟交」——这是有意为之（过期只提醒、不阻断）。
- **历史**：换了新模版，旧周报仍按当时的模版快照展示，不会被改写。

---

## 目录结构

```
yeyu/
├── shared/                  # 跨端共享：DTO 类型、zod 校验、枚举与文案、ISO 周工具
├── server/                  # 服务端（Fastify + Prisma）
│   ├── prisma/
│   │   ├── schema.prisma    # 数据模型（冻结契约）
│   │   ├── seed.ts          # 首个管理员 + 可选示例资产（幂等）
│   │   └── dev.db           # SQLite 数据文件（运行时生成，不入库）
│   └── src/
│       ├── app.ts           # buildApp()：注册 CORS/multipart/错误处理/各模块
│       ├── index.ts         # 监听入口（PORT/HOST）
│       ├── lib/             # errors / prisma / audit / storage（上传下载）/ time
│       ├── plugins/auth.ts  # JWT 签发与校验、requireAuth/requireAdmin、行级权限
│       └── modules/         # users（账号权限）/ assets（台账）/ reports（周报）
├── desktop/                 # Electron 客户端
│   ├── electron/            # 主进程 + preload（config.json、printPdf 桥）
│   ├── src/                 # 渲染层：App、pages、api/client、auth、ui、styles.css
│   └── electron-builder.yml # 打包配置（免签名 mac/win）
├── deploy/                  # Dockerfile、docker-compose.yml、nginx 示例、.env 示例
├── scripts/                 # dev.sh / build-mac.sh / build-win.sh / backup.sh / restore.sh
└── docs/
    ├── API.md               # **接口契约（冻结）**，改动必须先改这里
    └── 部署与使用.md          # 上线、备份恢复、升级、常见故障
```

---

## 仓库里没有什么

- **不含任何真实的资产台账、周报内容或周报模版**：数据库（`server/prisma/*.db`）与上传目录（`uploads/`）都在 `.gitignore` 里，从未进入 git 历史。
- 代码与文档中的手机号（`13800000000` 等）均为**演示占位值**；seed 可用 `SEED_ADMIN_PHONE` / `SEED_ADMIN_NAME` / `SEED_ADMIN_PASSWORD` 覆盖。
- `SEED_DEMO=1` 时生成的示例资产为虚构数据。
- 真实数据只存在于你自己的运行环境：`server/prisma/dev.db` 与 `server/uploads/<年-月>/`。

---

## 快速开始（本机开发）

前置：Node.js 20+（实测 24）、pnpm 11。

**一条命令**（自动装依赖、清端口、建表、seed、起后端+前端+桌面窗口）：

```bash
pnpm start            # 等价于 bash scripts/start-local.sh
```

登录：`13800000000` / `Admin@123456`（**本地演示默认值**，由 `SEED_ADMIN_PHONE` / `SEED_ADMIN_PASSWORD` 覆盖）。
关窗口或 `Ctrl+C` 结束全部进程。

手工分步（理解每一层用）：

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/   # GitHub 不可达时用镜像
pnpm install
cp server/.env.example server/.env      # 改 JWT_SECRET
pnpm db:push                            # 建表
pnpm db:seed                            # 首个管理员（SEED_ADMIN_PASSWORD 可覆盖）
pnpm dev                                # 服务端 4000 + Vite 5173 + Electron 窗口
```

> 开发启动器 `desktop/scripts/dev.mjs` 会主动剥掉继承来的 `ELECTRON_RUN_AS_NODE`
> （VS Code / DSH 等 Electron 应用的集成终端会带这个变量，它会让 electron 退化成纯 Node、
> 窗口永远不出现），并且用双栈探测等 Vite 就绪——Vite 默认只监听 `::1`。
> 需要 DevTools 时加 `OPEN_DEVTOOLS=1`；需要给 Electron 传额外参数用 `EXTRA_ELECTRON_ARGS="..."`。

其他脚本：

| 命令 | 作用 |
| --- | --- |
| `pnpm typecheck` | 全部包 TypeScript 严格模式检查 |
| `pnpm test` | 后端 vitest（用独立测试库，不碰 `dev.db`） |
| `pnpm db:push` | 同步 `schema.prisma` 到 SQLite |
| `pnpm db:seed` | 幂等 seed：首个管理员；`SEED_DEMO=1` 附带 5 条示例资产 |
| `pnpm build:mac` / `pnpm build:win` | 打 macOS / Windows 免签名安装包 |

> 依赖约束：**不要新增运行时依赖**。现有依赖（fastify / prisma / exceljs / docx / bcryptjs / jsonwebtoken / zod / tiptap / react-router 等）已覆盖全部需求。

---

## 构建产物

打包配置在 `desktop/electron-builder.yml`（`appId=com.yeyu.desktop`、`productName=页屿`、`identity: null` 免签名），产物输出到 `desktop/release/`：

| 平台 | 产物 |
| --- | --- |
| macOS | `release/yeyu-0.1.0-mac-arm64.dmg`（实测 94MB）；可执行目录 `release/mac-arm64/页屿.app`（`--dir` 快验） |
| Windows | `release/yeyu-0.1.0-win-x64-setup.exe`（NSIS，实测 78MB，macOS 上交叉构建通过；可改安装路径、创建「页屿」快捷方式） |

> 打包产物已实测：解包后的 `页屿.app` 能正常启动、以 `file://` 加载界面、读取 userData 里的会话并直接进入工作台。
> 注意：若从终端启动时环境里有 `ELECTRON_RUN_AS_NODE=1`（某些 IDE/工具链会注入），应用会以 Node 模式跑主进程并静默退出；`pnpm dev` 已自动剥离，手动启动打包版时用 `env -u ELECTRON_RUN_AS_NODE` 包一层即可。

免签名意味着：macOS 首次打开要「右键 → 打开」或 `xattr -cr`，Windows 首次运行会遇 SmartScreen「仍要运行」。
完整打包、内网镜像、pnpm strictDepBuilds 的说明见 [docs/部署与使用.md](docs/部署与使用.md) 第 5 节。

---

## 接口文档

**`docs/API.md` 是冻结的接口契约**，也是并行开发的唯一真相：端点、权限、错误码、DTO 形状、审计要求都写在这里。
服务端用 `@yeyu/shared` 的 zod schema 校验入参，错误统一 `{ error: { code, message, details? } }`，列表统一 `{ items, total, page, pageSize }`。
健康检查：`GET /api/health` → `{ "ok": true, "at": "<ISO>" }`。

---

## 当前能力

| 模块 | 能力 |
| --- | --- |
| 账号与权限 | 手机号注册（默认 `PENDING` 待审批）、登录发 7 天 JWT、管理员审批/禁用/改角色/重置密码；接口 `/api/auth/*`、`/api/users*` |
| 成员分组 | 管理员建组/改名/删组（删组只把成员移回未分组，不删账号），成员行内指派小组，按小组筛选账号；一人一组；接口 `/api/groups*`，`PATCH /api/users/:id` 的 `groupId` |
| 资产台账 | 增删改查（行级权限：成员只能改自己负责的资产）、关键词/类别/状态/责任人筛选、分页排序、Excel 导入导出与模板、附件上传（照片/发票/合同）与鉴权预览、借用/归还、盘点批次与差异表、审计日志；接口 `/api/assets*`、`/api/borrows*`、`/api/inventory/*`、`/api/audit` |
| 图文周报 | ISO 周键 `YYYY-Www`，一人一周一份；TipTap 富文本 + 图片（存 `<img src="media:<id>">`，渲染时换带 token 的真实地址）；草稿自动保存、提交、管理员通过/退回、评论串、导出 Word（`docx`）与 PDF（Electron `printPdf`）；接口 `/api/reports*` |
| 媒体 | `POST /api/media` 上传（≤20MB，白名单 MIME）、`GET /api/media/:id` 鉴权预览、`DELETE` 上传者或管理员 |
| 运维 | 一键 seed 首个管理员、Docker Compose 部署、`scripts/backup.sh`/`restore.sh` 备份恢复、免签名打包脚本 |

> 上述能力以 `docs/API.md` 为准：每个模块在 `server/src/modules/<模块>` 与 `desktop/src/pages/` 下成对实现，
> `/api/health` 与媒体接口（`lib/storage.ts`）由公共层提供。

## 未做项（明确的边界）

- **不支持的部署形态**：多实例/负载均衡（SQLite 单文件不支持）、多租户、公网直连（默认无 HTTPS，需自行加 nginx）。
- **账号体系**：无邮箱/短信找回密码（由管理员重置）、无 SSO/LDAP、无二次验证。
- **通知**：无邮件/IM 提醒，本周未交只在工作台标红。
- **报表**：无图表统计与 BI 导出，只有列表筛选 + Excel 导出。
- **附件**：无在线预览 PDF 之外的能力（不做 PDF 文本抽取、不做 OCR）。
- **客户端**：不做自动更新（无签名证书，手动换安装包）；无 Linux 包。
- **运维**：无内置定时备份守护（用 crontab 调 `scripts/backup.sh`）、无监控告警、无数据库迁移框架（表结构靠 `prisma db push`）。

---

## 许可与归属

- 代码：仓库目前**未附开源许可证**（默认保留所有权利）。如需对外复用，可自行采用 MIT / Apache-2.0。
- 登录页背景照片：来自 [Unsplash](https://unsplash.com)（Unsplash License，可商用、无需署名），
  文件为 `desktop/src/assets/login-bg.jpg`，本地 900×1300、约 180KB；替换同名文件即可换成自己的照片。
- 界面图标与应用图标：本项目自制（Pillow 生成 `desktop/build/icon.*`）。
