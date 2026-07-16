import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { build } from 'vite'

const execFileAsync = promisify(execFile)
const root = process.cwd()
const buildTool = path.join(root, 'tools', 'build-genshin-launch.mjs')
const assetMap = path.join(root, '.cache', 'genshin-launch', 'asset-map.json')
const configFile = path.join(root, 'launch', 'vite.config.ts')

async function runBuildTool (command) {
  const result = await execFileAsync(process.execPath, [buildTool, command], {
    cwd: root,
    maxBuffer: 8 * 1024 * 1024
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

try {
  await fs.access(assetMap)
} catch {
  await runBuildTool('prepare')
}

const watcher = await build({
  configFile,
  build: { watch: {} }
})

if (!watcher || Array.isArray(watcher) || typeof watcher.on !== 'function') {
  throw new Error('Vite did not return a launch build watcher')
}

let finalizeQueue = Promise.resolve()
watcher.on('event', (event) => {
  if (event.code === 'ERROR') {
    process.exitCode = 1
    console.error(event.error)
    return
  }
  if (event.code !== 'END') return
  finalizeQueue = finalizeQueue
    .then(() => runBuildTool('finalize'))
    .catch((error) => {
      process.exitCode = 1
      console.error(error)
    })
})

async function close () {
  await finalizeQueue
  await watcher.close()
}

process.once('SIGINT', () => void close().finally(() => process.exit()))
process.once('SIGTERM', () => void close().finally(() => process.exit()))
