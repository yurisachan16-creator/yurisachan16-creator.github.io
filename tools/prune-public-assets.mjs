import fs from 'node:fs/promises'
import path from 'node:path'

const PUBLIC_DIR = path.resolve('public')
const LIMIT_BYTES = 25 * 1024 * 1024

async function walkFiles (dir) {
  const result = []
  let entries = []
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return result
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...(await walkFiles(full)))
    } else if (entry.isFile()) {
      result.push(full)
    }
  }
  return result
}

function shouldPrune (filePath, size) {
  if (size <= LIMIT_BYTES) return false
  return true
}

async function main () {
  const files = await walkFiles(PUBLIC_DIR)
  let prunedCount = 0
  let prunedBytes = 0

  for (const file of files) {
    const stat = await fs.stat(file)
    if (!shouldPrune(file, stat.size)) continue

    try {
      await fs.unlink(file)
      prunedCount += 1
      prunedBytes += stat.size
      console.log(`[prune] removed oversized asset: ${path.relative(PUBLIC_DIR, file)} (${stat.size} bytes)`)
    } catch (err) {
      console.warn(`[prune] failed to remove ${file}:`, err.message)
    }
  }

  console.log(`[prune] done. removed ${prunedCount} files, ${(prunedBytes / (1024 * 1024)).toFixed(2)} MiB total.`)
}

main().catch((err) => {
  console.error('[prune] fatal:', err)
  process.exit(1)
})
