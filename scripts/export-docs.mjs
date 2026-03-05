#!/usr/bin/env node

/**
 * VISTA 文档 PDF 批量导出脚本
 *
 * 用法:
 *   node scripts/export-docs.mjs              # 导出全部文档
 *   node scripts/export-docs.mjs --file 01    # 导出指定编号文档
 *   node scripts/export-docs.mjs --version 0.2.0  # 覆盖版本号
 *   node scripts/export-docs.mjs --combined   # 合并为单个 PDF
 */

import { readFileSync, readdirSync, mkdirSync, existsSync, writeFileSync } from "fs";
import { join, basename, resolve, dirname } from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const DOCS_DIR = join(ROOT, "docs");
const SCRIPTS_DIR = join(ROOT, "scripts");
const CSS_FILE = join(SCRIPTS_DIR, "pdf-style.css");
const VERSION_FILE = join(DOCS_DIR, "version.json");

// ─── Chrome 查找 ────────────────────────────────────────────

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      execSync(`test -x "${p}"`, { stdio: "ignore" });
      return p;
    } catch {}
  }

  return undefined; // 回退到 Puppeteer 内置
}

// ─── 参数解析 ───────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { files: [], version: null, combined: false, help: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--file":
      case "-f":
        opts.files.push(args[++i]);
        break;
      case "--version":
      case "-v":
        opts.version = args[++i];
        break;
      case "--combined":
      case "-c":
        opts.combined = true;
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
    }
  }
  return opts;
}

// ─── 版本与元信息 ────────────────────────────────────────────

function loadVersion(overrideVersion) {
  const versionData = JSON.parse(readFileSync(VERSION_FILE, "utf-8"));
  const version = overrideVersion || versionData.version;
  const project = versionData.project;

  let gitHash = "unknown";
  try {
    gitHash = execSync("git rev-parse --short HEAD", { cwd: ROOT })
      .toString()
      .trim();
  } catch {}

  const date = new Date().toISOString().split("T")[0];

  return { version, project, gitHash, date, fullVersion: `v${version} (${gitHash})` };
}

// ─── 文档发现 ────────────────────────────────────────────────

function discoverDocs(filterPatterns) {
  const files = readdirSync(DOCS_DIR)
    .filter((f) => f.endsWith(".md") && f !== "00.md")
    .sort();

  if (filterPatterns.length === 0) return files;

  return files.filter((f) =>
    filterPatterns.some((p) => f.includes(p))
  );
}

// ─── 文档标题映射 ────────────────────────────────────────────

const DOC_TITLES = {
  "01-architecture-overview.md": "系统架构总览",
  "02-technology-stack.md": "技术选型说明",
  "03-module-design.md": "模块详细设计",
  "04-database-design.md": "数据库设计",
  "05-api-design.md": "接口设计规范",
  "06-deployment-architecture.md": "部署架构",
  "07-non-functional-requirements.md": "非功能性需求",
  "08-development-tasks.md": "开发任务分解",
  "09-sprint-plan.md": "Sprint迭代计划",
  "10-collaboration-guide.md": "协作规范与工具链",
};

function getDocTitle(filename) {
  return DOC_TITLES[filename] || filename.replace(".md", "");
}

// ─── Markdown 预处理 ─────────────────────────────────────────

function preprocessMarkdown(content, meta) {
  const lines = content.split("\n");

  // 替换文档头部的版本/日期信息
  const processed = lines.map((line) => {
    if (line.match(/^>\s*版本：/)) return `> 版本：${meta.fullVersion}`;
    if (line.match(/^>\s*日期：/)) return `> 日期：${meta.date}`;
    return line;
  });

  return processed.join("\n");
}

// ─── 生成封面页 Markdown ─────────────────────────────────────

function generateCoverPage(meta, docFiles) {
  const toc = docFiles
    .map((f, i) => {
      const num = String(i + 1).padStart(2, "0");
      return `${num}. ${getDocTitle(f)}`;
    })
    .join("\n");

  return `# ${meta.project}

> **技术文档合集**
>
> 版本：${meta.fullVersion}
> 导出日期：${meta.date}

---

## 目录

${toc}

---

*本文档由 VISTA 文档导出工具自动生成*
`;
}

// ─── PDF 导出（使用 md-to-pdf）────────────────────────────────

async function exportSinglePdf(mdFile, outputPath, meta) {
  const { mdToPdf } = await import("md-to-pdf");

  const mdContent = readFileSync(join(DOCS_DIR, mdFile), "utf-8");
  const processed = preprocessMarkdown(mdContent, meta);

  const cssContent = readFileSync(CSS_FILE, "utf-8");

  const pdf = await mdToPdf(
    { content: processed },
    {
      css: cssContent,
      document_title: `${meta.project} — ${getDocTitle(mdFile)}`,
      pdf_options: {
        format: "A4",
        margin: { top: "20mm", bottom: "25mm", left: "18mm", right: "18mm" },
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: `
          <div style="width:100%;font-size:8px;padding:0 18mm;display:flex;justify-content:space-between;color:#888;font-family:sans-serif;">
            <span>${meta.project}</span>
            <span>${meta.fullVersion}</span>
          </div>`,
        footerTemplate: `
          <div style="width:100%;font-size:8px;padding:0 18mm;display:flex;justify-content:space-between;color:#888;font-family:sans-serif;">
            <span>${getDocTitle(mdFile)}</span>
            <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
          </div>`,
      },
      launch_options: {
        executablePath: findChrome(),
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
      },
    }
  ).catch((err) => {
    console.error(`  ✗ 导出失败: ${mdFile} — ${err.message}`);
    return null;
  });

  if (pdf?.content) {
    writeFileSync(outputPath, pdf.content);
    const sizeKB = Math.round(pdf.content.length / 1024);
    console.log(`  ✓ ${basename(outputPath)}  (${sizeKB} KB)`);
    return true;
  }
  return false;
}

async function exportCombinedPdf(docFiles, outputPath, meta) {
  const { mdToPdf } = await import("md-to-pdf");

  const coverPage = generateCoverPage(meta, docFiles);

  const allContent = [coverPage];
  for (const f of docFiles) {
    const raw = readFileSync(join(DOCS_DIR, f), "utf-8");
    allContent.push(preprocessMarkdown(raw, meta));
  }

  const combined = allContent.join("\n\n---\n\n");
  const cssContent = readFileSync(CSS_FILE, "utf-8");

  const pdf = await mdToPdf(
    { content: combined },
    {
      css: cssContent,
      document_title: `${meta.project} — 技术文档合集 ${meta.fullVersion}`,
      pdf_options: {
        format: "A4",
        margin: { top: "20mm", bottom: "25mm", left: "18mm", right: "18mm" },
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: `
          <div style="width:100%;font-size:8px;padding:0 18mm;display:flex;justify-content:space-between;color:#888;font-family:sans-serif;">
            <span>${meta.project} — 技术文档合集</span>
            <span>${meta.fullVersion}</span>
          </div>`,
        footerTemplate: `
          <div style="width:100%;font-size:8px;padding:0 18mm;display:flex;justify-content:center;color:#888;font-family:sans-serif;">
            <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
          </div>`,
      },
      launch_options: {
        executablePath: findChrome(),
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
      },
    }
  ).catch((err) => {
    console.error(`  ✗ 合并导出失败 — ${err.message}`);
    return null;
  });

  if (pdf?.content) {
    writeFileSync(outputPath, pdf.content);
    const sizeMB = (pdf.content.length / 1024 / 1024).toFixed(2);
    console.log(`  ✓ ${basename(outputPath)}  (${sizeMB} MB)`);
    return true;
  }
  return false;
}

// ─── 主流程 ──────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  if (opts.help) {
    console.log(`
VISTA 文档 PDF 导出工具

用法:
  node scripts/export-docs.mjs [选项]

选项:
  -f, --file <编号>      仅导出包含该编号的文档 (可多次使用)
  -v, --version <版本>   覆盖版本号 (默认读取 docs/version.json)
  -c, --combined         额外生成合并版 PDF
  -h, --help             显示帮助

示例:
  node scripts/export-docs.mjs                  # 导出全部
  node scripts/export-docs.mjs -f 01 -f 02      # 仅导出 01 和 02
  node scripts/export-docs.mjs -v 1.0.0 -c      # 指定版本 + 合并版
  npm run docs:pdf                               # 通过 npm script 运行
`);
    process.exit(0);
  }

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║       VISTA 文档 PDF 导出工具                ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  // 加载元信息
  const meta = loadVersion(opts.version);
  console.log(`  项目: ${meta.project}`);
  console.log(`  版本: ${meta.fullVersion}`);
  console.log(`  日期: ${meta.date}\n`);

  // 发现文档
  const docFiles = discoverDocs(opts.files);
  if (docFiles.length === 0) {
    console.error("  ✗ 未找到匹配的文档文件");
    process.exit(1);
  }
  console.log(`  待导出: ${docFiles.length} 个文档\n`);

  // 创建输出目录
  const outDirName = `VISTA_docs_v${meta.version}_${meta.date}`;
  const outDir = join(ROOT, "dist", outDirName);
  mkdirSync(outDir, { recursive: true });

  console.log("─── 导出单文档 ─────────────────────────────────\n");

  let successCount = 0;
  for (const f of docFiles) {
    const pdfName = f.replace(".md", `_v${meta.version}.pdf`);
    const outPath = join(outDir, pdfName);
    const ok = await exportSinglePdf(f, outPath, meta);
    if (ok) successCount++;
  }

  // 合并版导出
  if (opts.combined && docFiles.length > 1) {
    console.log("\n─── 导出合并版 ─────────────────────────────────\n");
    const combinedPath = join(
      outDir,
      `VISTA_全部文档_v${meta.version}.pdf`
    );
    await exportCombinedPdf(docFiles, combinedPath, meta);
  }

  // 生成导出清单
  const manifest = {
    project: meta.project,
    version: meta.fullVersion,
    export_date: meta.date,
    git_commit: meta.gitHash,
    documents: docFiles.map((f) => ({
      file: f,
      title: getDocTitle(f),
      pdf: f.replace(".md", `_v${meta.version}.pdf`),
    })),
  };
  writeFileSync(
    join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );

  console.log("\n─── 导出完成 ───────────────────────────────────\n");
  console.log(`  成功: ${successCount}/${docFiles.length}`);
  console.log(`  输出: dist/${outDirName}/`);
  console.log("");
}

main().catch((err) => {
  console.error("导出异常:", err);
  process.exit(1);
});
