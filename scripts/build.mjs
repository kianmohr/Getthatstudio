import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

const passthroughExtensions = new Set([
  ".css",
  ".gif",
  ".html",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".pdf",
  ".png",
  ".svg",
  ".txt",
  ".webp"
]);

const passthroughDirectories = new Set([
  "assets",
  "get-that-bod",
  "public"
]);

const excludedFiles = new Set([
  "package.json",
  "package-lock.json",
  "square-source.html",
  "README.md",
  "PROJECT_NOTES.md"
]);

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyRootFiles() {
  const entries = await readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(rootDir, entry.name);
    const destinationPath = path.join(distDir, entry.name);

    if (
      entry.isFile() &&
      !excludedFiles.has(entry.name) &&
      passthroughExtensions.has(path.extname(entry.name).toLowerCase())
    ) {
      await cp(sourcePath, destinationPath, { recursive: false });
    }

    if (entry.isDirectory() && passthroughDirectories.has(entry.name)) {
      await cp(sourcePath, destinationPath, { recursive: true });
    }
  }
}

async function build() {
  if (await pathExists(distDir)) {
    await rm(distDir, { recursive: true, force: true });
  }

  await mkdir(distDir, { recursive: true });
  await copyRootFiles();

  console.log(`Built site into ${distDir}`);
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
