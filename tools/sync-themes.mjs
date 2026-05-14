import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function copyIfExists(sourcePath, destinationPath) {
  try {
    await fs.access(sourcePath);
  } catch {
    return false;
  }

  await fs.cp(sourcePath, destinationPath, { recursive: true, force: true });
  return true;
}

async function syncTheme({ themeName, packageName }) {
  const sourcePath = path.join(projectRoot, "node_modules", packageName);
  const destinationPath = path.join(projectRoot, "themes", themeName);
  const overridePath = path.join(projectRoot, "theme-overrides", themeName);

  try {
    await fs.access(sourcePath);
  } catch {
    throw new Error(`Theme package not found: ${sourcePath}`);
  }

  await fs.rm(destinationPath, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.cp(sourcePath, destinationPath, { recursive: true, force: true });
  await copyIfExists(overridePath, destinationPath);
}

await syncTheme({ themeName: "butterfly", packageName: "hexo-theme-butterfly" });
