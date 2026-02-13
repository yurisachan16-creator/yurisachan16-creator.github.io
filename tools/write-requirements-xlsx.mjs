import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import ExcelJS from "exceljs";

const projectRoot = path.resolve(process.cwd());
const xlsxPath = path.join(projectRoot, "doc", "需求.xlsx");

function nowLocalString() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}`;
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function trimEmptyRows(rows) {
  const out = [];
  for (const row of rows) {
    if (!row) continue;
    const hasAny = Object.values(row).some((v) => String(v ?? "").trim() !== "");
    if (hasAny) out.push(row);
  }
  return out;
}

function removeSheetIfExists(workbook, sheetName) {
  const existing = workbook.getWorksheet(sheetName);
  if (!existing) return;
  workbook.removeWorksheet(existing.id);
}

function setupTable(worksheet, columns, rows) {
  worksheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 20 }));
  worksheet.addRows(rows);

  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  headerRow.height = 18;

  worksheet.eachRow((row, rowNumber) => {
    row.alignment = { vertical: "top", horizontal: "left", wrapText: true };
    if (rowNumber > 1) row.height = 18;
  });
}

function extractSimpleKV(yamlText, key) {
  const re = new RegExp(`^${key}:\\s*(.+)\\s*$`, "m");
  const m = yamlText.match(re);
  if (!m) return "";
  return m[1].replace(/^['"]|['"]$/g, "");
}

function extractMenuBlock(butterflyYaml) {
  const lines = butterflyYaml.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => l.trim() === "menu:");
  if (startIdx < 0) return [];
  const items = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("  ")) break;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf(":");
    if (sep < 0) continue;
    const label = trimmed.slice(0, sep).trim();
    const rest = trimmed.slice(sep + 1).trim();
    items.push({ label, value: rest });
  }
  return items;
}

async function getRepoSnapshot() {
  const hexoConfigPath = path.join(projectRoot, "_config.yml");
  const butterflyConfigPath = path.join(projectRoot, "_config.butterfly.yml");
  const packageJsonPath = path.join(projectRoot, "package.json");
  const workflowPath = path.join(projectRoot, ".github", "workflows", "pages.yml");

  const [hexoYaml, butterflyYaml, packageJsonText, workflowText] = await Promise.all([
    readTextIfExists(hexoConfigPath),
    readTextIfExists(butterflyConfigPath),
    readTextIfExists(packageJsonPath),
    readTextIfExists(workflowPath),
  ]);

  const packageJson = packageJsonText ? JSON.parse(packageJsonText) : {};

  return {
    generatedAt: nowLocalString(),
    hexo: {
      url: extractSimpleKV(hexoYaml, "url"),
      permalink: extractSimpleKV(hexoYaml, "permalink"),
      postAssetFolder: extractSimpleKV(hexoYaml, "post_asset_folder"),
      theme: extractSimpleKV(hexoYaml, "theme"),
      timezone: extractSimpleKV(hexoYaml, "timezone"),
    },
    butterfly: {
      indexImg: extractSimpleKV(butterflyYaml, "index_img"),
      defaultTopImg: extractSimpleKV(butterflyYaml, "default_top_img"),
      menu: extractMenuBlock(butterflyYaml),
    },
    npm: {
      scripts: packageJson.scripts ?? {},
      dependencies: packageJson.dependencies ?? {},
      devDependencies: packageJson.devDependencies ?? {},
    },
    actions: {
      workflow: workflowText,
    },
  };
}

function buildOverview(snapshot) {
  return trimEmptyRows([
    {
      module: "站点生成",
      description: "Hexo 负责把 source 内容生成静态站点到 public",
      entry: "npm run build / _config.yml",
      output: "public/",
      notes: `permalink=${snapshot.hexo.permalink}；post_asset_folder=${snapshot.hexo.postAssetFolder}`,
    },
    {
      module: "主题与界面",
      description: "Butterfly 主题负责 UI、布局、组件与注入资源",
      entry: "_config.butterfly.yml",
      output: "页面渲染效果",
      notes: "自定义 CSS/JS 建议放 source/css 与 source/js，并通过 inject 引入",
    },
    {
      module: "本地开发",
      description: "本地预览与写作",
      entry: "npm install; npm run server",
      output: "http://localhost:4000/",
      notes: "写完文章 push main 触发 Actions 自动发布",
    },
    {
      module: "自动发布",
      description: "GitHub Actions 构建并发布到 GitHub Pages",
      entry: ".github/workflows/pages.yml",
      output: "线上站点",
      notes: "push main 自动发布；PR 仅构建验证",
    },
  ]);
}

function buildStructure(snapshot) {
  const rows = [
    {
      path: "/source/_posts/",
      type: "dir",
      category: "内容",
      purpose: "文章 Markdown（可按年份分目录）",
      examples: "source/_posts/2026/2026-02-09-lei-xing-cun-zhe-you-xi.md",
      published: "Y",
      notes: "post_asset_folder=true 时，文章资源目录与 md 同级",
    },
    {
      path: "/source/img/",
      type: "dir",
      category: "内容",
      purpose: "全站静态图片（非文章私有资源）",
      examples: "首页 banner、头像、通用配图",
      published: "Y",
      notes: "适合被多篇文章复用的资源",
    },
    {
      path: "/source/css/custom.css",
      type: "file",
      category: "内容",
      purpose: "自定义样式（字体/动态背景/深色模式等）",
      examples: "通过主题 inject 引入",
      published: "Y",
      notes: "路径为 /css/custom.css",
    },
    {
      path: "/source/js/cloud-bg.js",
      type: "file",
      category: "内容",
      purpose: "动态背景脚本（页面类型识别 + PJAX 兼容）",
      examples: "通过主题 inject 引入",
      published: "Y",
      notes: "路径为 /js/cloud-bg.js",
    },
    {
      path: "/_config.yml",
      type: "file",
      category: "配置",
      purpose: "Hexo 主配置",
      examples: `url=${snapshot.hexo.url}; permalink=${snapshot.hexo.permalink}`,
      published: "N",
      notes: "改动会影响全站生成与路径",
    },
    {
      path: "/_config.butterfly.yml",
      type: "file",
      category: "配置",
      purpose: "Butterfly 主题配置",
      examples: "menu、cover、inject、自定义资源",
      published: "N",
      notes: "控制首页封面、导航菜单、注入资源等",
    },
    {
      path: "/.github/workflows/pages.yml",
      type: "file",
      category: "自动化",
      purpose: "Pages 构建与发布工作流",
      examples: "npm ci → npm run build → upload public",
      published: "N",
      notes: "仓库 Settings → Pages 需要选择 GitHub Actions",
    },
    {
      path: "/tools/",
      type: "dir",
      category: "工具",
      purpose: "本地脚本（不会发布到站点）",
      examples: "图片处理脚本、主题同步脚本等",
      published: "N",
      notes: "不要把工具脚本放到 source/ 里",
    },
    {
      path: "/doc/需求.xlsx",
      type: "file",
      category: "文档",
      purpose: "结构/规范/扩展记录表",
      examples: "本脚本自动写入更新",
      published: "N",
      notes: `本次生成时间：${snapshot.generatedAt}`,
    },
  ];

  for (const item of snapshot.butterfly.menu) {
    rows.push({
      path: "/_config.butterfly.yml#menu",
      type: "config",
      category: "配置",
      purpose: "导航菜单项",
      examples: `${item.label}: ${item.value}`,
      published: "N",
      notes: "",
    });
  }

  return trimEmptyRows(rows);
}

function buildInterfaces(snapshot) {
  const rows = [
    {
      type: "CLI",
      name: "本地预览",
      entry: "npm run server",
      input: "source/ + 配置",
      output: "http://localhost:4000/",
      troubleshooting: "端口被占用/依赖未装/主题未同步",
    },
    {
      type: "CLI",
      name: "生成静态站点",
      entry: "npm run build",
      input: "source/ + 配置",
      output: "public/",
      troubleshooting: "封面/图片路径写成相对路径导致首页 404",
    },
    {
      type: "CLI",
      name: "清理缓存",
      entry: "npm run clean",
      input: "无",
      output: "清理 db.json 与 public 等缓存",
      troubleshooting: "生成异常时优先 clean 后再 build",
    },
    {
      type: "CI",
      name: "Actions 构建与发布",
      entry: ".github/workflows/pages.yml (push main)",
      input: "main 分支源码",
      output: "GitHub Pages",
      troubleshooting: "Settings→Pages 未设为 GitHub Actions/依赖安装失败/生成失败",
    },
    {
      type: "配置",
      name: "永久链接规则",
      entry: "_config.yml#permalink",
      input: "文章 date/title",
      output: "文章 URL 结构",
      troubleshooting: "改规则会影响历史链接；可用 front-matter permalink 固定单篇路径",
    },
    {
      type: "配置",
      name: "文章资源文件夹",
      entry: "_config.yml#post_asset_folder",
      input: "文章同名目录资源",
      output: "生成到 public 的文章资源",
      troubleshooting: "资源目录需与文章 md 同级；封面建议用以 / 开头的绝对路径",
    },
    {
      type: "Front-matter",
      name: "封面 cover",
      entry: "post.md front-matter#cover",
      input: "图片路径",
      output: "首页卡片封面/文章页封面",
      troubleshooting: "推荐使用站点绝对路径，如 /2026/02/09/.../cover.jpg",
    },
  ];

  for (const [k, v] of Object.entries(snapshot.npm.scripts)) {
    rows.push({
      type: "CLI",
      name: `npm script: ${k}`,
      entry: `package.json#scripts.${k}`,
      input: "",
      output: String(v),
      troubleshooting: "",
    });
  }

  return trimEmptyRows(rows);
}

function buildContentSpec() {
  return trimEmptyRows([
    {
      item: "Front-matter 必填",
      rule: "title/date/updated/tags/categories/keywords/description/cover/permalink",
      example:
        "title: ...\\ndate: 2026-02-09 02:51:48\\ncover: /2026/02/09/.../cover.jpg\\npermalink: /2026/02/09/.../",
      check: "手动检查 + 本地 build",
      notes: "cover 建议用绝对路径，避免首页 404",
    },
    {
      item: "标题层级",
      rule: "全文仅一个 H1（#）；二级 ##；三级 ###；禁止跳级",
      example: "# 标题\\n## 小节\\n### 子小节",
      check: "手动检查",
      notes: "避免 TOC 锚点混乱",
    },
    {
      item: "摘要截断",
      rule: "必须加入 <!-- more -->，首页摘要控制在 200 字以内",
      example: "开头两段介绍\\n\\n<!-- more -->\\n\\n正文...",
      check: "本地首页预览",
      notes: "",
    },
    {
      item: "图片（文章资源）",
      rule: "post_asset_folder=true 时，优先用 {% asset_img xxx.png \"说明\" %}",
      example: "{% asset_img gameplay-1.png \"战斗界面截图\" class=\"full-width\" %}",
      check: "hexo generate 后检查 public 是否有对应图片",
      notes: "宽度 > 800px 建议加 full-width",
    },
    {
      item: "代码块",
      rule: "所有代码块标注语言（```cpp / ```python / ```js）",
      example: "```js\\nconsole.log('hi')\\n```",
      check: "本地文章页预览",
      notes: "保证高亮稳定",
    },
    {
      item: "参考资料",
      rule: "文末统一用有序列表，格式 [title](url)，上线前确认可访问",
      example: "1. [GitHub 仓库](https://github.com/...)",
      check: "手动打开链接",
      notes: "",
    },
  ]);
}

function buildExtend() {
  return trimEmptyRows([
    {
      goal: "新增独立页面（如 /projects）",
      touchpoints: "source/projects/index.md + _config.butterfly.yml#menu",
      steps: "npx hexo new page \"projects\" → 写内容 → menu 增加入口",
      verify: "npm run server 访问 /projects/",
      risk: "导航路径拼写错误；回滚删除目录与 menu 项",
    },
    {
      goal: "新增全站 CSS",
      touchpoints: "source/css/*.css + _config.butterfly.yml#inject.head",
      steps: "新增 CSS 文件 → inject.head 引入",
      verify: "本地预览确认生效",
      risk: "覆盖主题样式导致布局异常；回滚移除注入",
    },
    {
      goal: "新增全站 JS（PJAX 兼容）",
      touchpoints: "source/js/*.js + _config.butterfly.yml#inject.bottom",
      steps: "新增 JS 文件 → inject.bottom 引入 → 监听 pjax:complete 重新绑定",
      verify: "切换页面后功能仍正常",
      risk: "重复绑定事件/内存泄露；回滚移除注入",
    },
    {
      goal: "新增 Hexo 插件（如 sitemap）",
      touchpoints: "package.json + _config.yml",
      steps: "npm i 插件 → 配置 → npm run build",
      verify: "public/ 生成对应文件；Actions 通过",
      risk: "Actions 构建失败；回滚依赖与配置",
    },
  ]);
}

function buildReleaseOps() {
  return trimEmptyRows([
    {
      scenario: "发布到线上（路线 B）",
      action: "git commit + git push origin main",
      trigger: "push main",
      artifact: "GitHub Pages",
      symptom: "Pages 未更新/站点 404",
      fix: "Settings→Pages Source 选 GitHub Actions；查看 Actions 日志",
    },
    {
      scenario: "仅验证构建（PR）",
      action: "提交 PR",
      trigger: "pull_request",
      artifact: "Actions 构建日志",
      symptom: "构建失败",
      fix: "按日志定位依赖/配置/资源路径问题；本地先 npm run build 复现",
    },
    {
      scenario: "首页封面显示 404",
      action: "检查文章 front-matter cover 字段",
      trigger: "首页卡片加载封面",
      artifact: "封面图片请求",
      symptom: "封面显示 404 图",
      fix: "cover 用站点绝对路径（以 / 开头）；重新 build",
    },
  ]);
}

async function main() {
  const snapshot = await getRepoSnapshot();

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);

  const sheets = [
    {
      name: "Overview",
      columns: [
        { header: "模块/主题", key: "module", width: 18 },
        { header: "说明", key: "description", width: 38 },
        { header: "入口（文件/命令）", key: "entry", width: 30 },
        { header: "输出物", key: "output", width: 18 },
        { header: "维护要点", key: "notes", width: 40 },
      ],
      rows: buildOverview(snapshot),
    },
    {
      name: "Structure",
      columns: [
        { header: "路径", key: "path", width: 40 },
        { header: "类型", key: "type", width: 10 },
        { header: "归类", key: "category", width: 12 },
        { header: "用途", key: "purpose", width: 28 },
        { header: "示例/关键点", key: "examples", width: 46 },
        { header: "是否发布(Y/N)", key: "published", width: 14 },
        { header: "备注", key: "notes", width: 36 },
      ],
      rows: buildStructure(snapshot),
    },
    {
      name: "Interfaces",
      columns: [
        { header: "接口类型", key: "type", width: 12 },
        { header: "名称", key: "name", width: 22 },
        { header: "入口（命令/文件#键）", key: "entry", width: 36 },
        { header: "输入", key: "input", width: 22 },
        { header: "输出/影响", key: "output", width: 28 },
        { header: "常见问题/排查", key: "troubleshooting", width: 42 },
      ],
      rows: buildInterfaces(snapshot),
    },
    {
      name: "ContentSpec",
      columns: [
        { header: "规范项", key: "item", width: 18 },
        { header: "规则", key: "rule", width: 40 },
        { header: "示例", key: "example", width: 50 },
        { header: "检查方式", key: "check", width: 20 },
        { header: "备注", key: "notes", width: 30 },
      ],
      rows: buildContentSpec(),
    },
    {
      name: "Extend",
      columns: [
        { header: "扩展目标", key: "goal", width: 24 },
        { header: "修改点（文件/目录）", key: "touchpoints", width: 44 },
        { header: "最小步骤", key: "steps", width: 46 },
        { header: "验证方式", key: "verify", width: 30 },
        { header: "风险/回滚", key: "risk", width: 34 },
      ],
      rows: buildExtend(),
    },
    {
      name: "ReleaseOps",
      columns: [
        { header: "场景", key: "scenario", width: 20 },
        { header: "操作", key: "action", width: 34 },
        { header: "触发条件", key: "trigger", width: 18 },
        { header: "产物", key: "artifact", width: 18 },
        { header: "故障现象", key: "symptom", width: 20 },
        { header: "处理办法", key: "fix", width: 44 },
      ],
      rows: buildReleaseOps(),
    },
  ];

  for (const sheet of sheets) {
    removeSheetIfExists(workbook, sheet.name);
    const ws = workbook.addWorksheet(sheet.name);
    setupTable(ws, sheet.columns, sheet.rows);
  }

  await workbook.xlsx.writeFile(xlsxPath);

  const summary = sheets
    .map((s) => `${s.name}(${s.rows.length}行)`)
    .join("，");
  console.log(`已写入 ${xlsxPath}`);
  console.log(`包含：${summary}`);
}

await main();
