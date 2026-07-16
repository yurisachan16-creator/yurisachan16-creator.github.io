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
  for (const file of files) {
    const stat = await fs.stat(file)
    if (!shouldPrune(file, stat.size)) continue

    const relative = path.relative(PUBLIC_DIR, file)
    throw new Error(`public asset exceeds the Cloudflare 25 MiB limit: ${relative} (${stat.size} bytes)`)
  }

  console.log(`[prune] checked ${files.length} public files; none exceeds 25 MiB.`)
}

main().catch((err) => {
  console.error('[prune] fatal:', err)
  process.exit(1)
})
