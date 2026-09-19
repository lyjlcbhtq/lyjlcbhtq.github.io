import { copyFileSync, readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";

// 用法:
//   node push.mjs <文件...>      加密推送到 pics/(图片等)
//   node push.mjs --rm <名字>    从 pics/ 删除文件(名字含 .enc 后缀)
// 密码从仓库外的 ../hub-pass.txt 读取,绝不进入仓库与提交历史。
// 加密格式: "SBHUB1" + salt(16) + iv(12) + AES-256-GCM(密文+tag),PBKDF2-SHA256 310000 次,
// 与 index.html 里的 WebCrypto 解密逻辑一一对应。

const root = dirname(fileURLToPath(import.meta.url));
const picsDir = join(root, "pics");
const passPath = join(root, "..", "hub-pass.txt");

function loadPass() {
  if (!existsSync(passPath)) {
    console.error(`找不到密码文件: ${passPath}(文件在仓库外,不会被提交)`);
    process.exit(1);
  }
  return readFileSync(passPath, "utf8").trim();
}

function deriveBits(pass, salt) {
  // Node 侧 PBKDF2,与浏览器 WebCrypto 参数一致
  return webcrypto.subtle
    .importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits", "deriveKey"])
    .then((km) =>
      webcrypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" },
        km,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt"]
      )
    );
}

async function encryptFile(pass, srcPath) {
  const plain = new Uint8Array(readFileSync(srcPath));
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBits(pass, salt);
  const cipher = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  const enc = new Uint8Array(cipher); // 密文 + 16 字节 auth tag
  const magic = new TextEncoder().encode("SBHUB1");
  const out = new Uint8Array(magic.length + salt.length + iv.length + enc.length);
  out.set(magic, 0);
  out.set(salt, magic.length);
  out.set(iv, magic.length + salt.length);
  out.set(enc, magic.length + salt.length + iv.length);
  return out;
}

const today = new Date();
const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(
  today.getDate()
).padStart(2, "0")}`;

function safeStem(name) {
  const stem = basename(name, extname(name));
  const cleaned = stem.replace(/[^A-Za-z0-9._-]/g, "").replace(/^[-.]+|[-.]+$/g, "");
  return cleaned || "img";
}

if (!existsSync(picsDir)) mkdirSync(picsDir);

const args = process.argv.slice(2);
const added = [];
const removed = [];

if (args[0] === "--rm") {
  for (const name of args.slice(1)) {
    const target = join(picsDir, basename(name));
    if (existsSync(target)) {
      unlinkSync(target);
      removed.push(basename(name));
      console.log(`deleted pics/${basename(name)}`);
    } else {
      console.error(`不存在: pics/${basename(name)}`);
    }
  }
} else {
  const pass = loadPass();
  for (const src of args) {
    if (!existsSync(src)) {
      console.error(`跳过(不存在): ${src}`);
      continue;
    }
    const ext = extname(src).toLowerCase() || ".bin";
    let name = `${stamp}-${safeStem(src)}${ext}.enc`;
    let n = 1;
    while (existsSync(join(picsDir, name))) {
      name = `${stamp}-${n}-${safeStem(src)}${ext}.enc`;
      n += 1;
    }
    const out = await encryptFile(pass, src);
    writeFileSync(join(picsDir, name), out);
    added.push(name);
    console.log(`encrypted -> pics/${name}`);
  }
}

// 重写 index.html 图片列表(全部 .enc 文件,最新在前)
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
    .filter((f) => /\.enc$/i.test(f))
    .sort()
    .reverse();
  const list = images.length
    ? `<ul style="list-style:none;padding:0">\n${images
        .map((f) => {
          const display = f.replace(/\.enc$/i, "");
          return `      <li data-file="pics/${f}" style="margin:6px 0;font-size:14px">🔒 ${display}</li>`;
        })
        .join("\n")}\n    </ul>`
    : `    <p class="empty">暂无图片</p>`;
  writeFileSync(
    indexPath,
    html.slice(0, startIdx + startMark.length) + "\n    " + list + "\n    " + html.slice(endIdx)
  );
  console.log(`index.html 图片列表已更新(${images.length} 张)`);
}

const { execSync } = await import("node:child_process");
const git = (args2) => execSync(`git ${args2}`, { cwd: root, stdio: "pipe" }).toString().trim();
git("add -A");
const summary = [...added.map((f) => `+${f}`), ...removed.map((f) => `-${f}`)].join(" ") || "index update";
git(`commit -m "hub: ${summary}"`);
git("push");
console.log("pushed,Pages 部署约 1 分钟后生效");
