import { copyFileSync, readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

// 用法: node push.mjs <文件1> [文件2 ...]
// 把文件推到本站 pics/ 下,自动重命名加日期前缀(非 ASCII 文件名转拼音前保留扩展名),
// 并重写 index.html 的图片列表区块,然后 git 提交推送。
const root = dirname(fileURLToPath(import.meta.url));
const picsDir = join(root, "pics");
if (!existsSync(picsDir)) mkdirSync(picsDir);

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("用法: node push.mjs <文件...>");
  process.exit(1);
}

const today = new Date();
const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(
  today.getDate()
).padStart(2, "0")}`;

function safeName(name) {
  const ext = extname(name);
  const stem = basename(name, ext).replace(/[\\/:*?"<>|\s]+/g, "-").replace(/[^A-Za-z0-9._-]/g, "");
  return `${stem || "file"}${ext.toLowerCase()}`;
}

const added = [];
for (const src of files) {
  if (!existsSync(src)) {
    console.error(`跳过(不存在): ${src}`);
    continue;
  }
  let target = join(picsDir, `${stamp}-${safeName(basename(src))}`);
  let n = 1;
  while (existsSync(target)) {
    target = join(picsDir, `${stamp}-${n}-${safeName(basename(src))}`);
    n += 1;
  }
  copyFileSync(src, target);
  added.push(basename(target));
  console.log(`copied -> pics/${basename(target)}`);
}

// 重写 index.html 的图片列表区块
const indexPath = join(root, "index.html");
const html = readFileSync(indexPath, "utf8");
const startMark = "<!-- pics-start:此区块由电脑端推送脚本自动维护 -->";
const endMark = "<!-- pics-end -->";
const startIdx = html.indexOf(startMark);
const endIdx = html.indexOf(endMark);
if (startIdx < 0 || endIdx < 0) {
  console.error("index.html 缺少 pics-start/pics-end 标记,跳过列表更新");
} else {
  const images = readdirSync(picsDir)
    .filter((f) => /\.(png|jpe?g|gif|webp|svg)$/i.test(f))
    .sort()
    .reverse();
  const list = images.length
    ? `<ul>\n${images.map((f) => `      <li><a href="pics/${f}">${f}</a></li>`).join("\n")}\n    </ul>`
    : `    <p class="empty">暂无图片</p>`;
  writeFileSync(
    indexPath,
    html.slice(0, startIdx + startMark.length) + "\n    " + list + "\n    " + html.slice(endIdx)
  );
  console.log(`index.html 图片列表已更新(${images.length} 张)`);
}

// 提交并推送
const { execSync } = await import("node:child_process");
const git = (args) => execSync(`git ${args}`, { cwd: root, stdio: "pipe" }).toString().trim();
git("add -A");
git(`commit -m "push: ${added.join(", ") || "index update"}"`);
git("push");
console.log("pushed to GitHub, Pages 部署约需 1 分钟后生效");
