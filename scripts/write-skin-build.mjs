import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const [skinRootArg, repository] = process.argv.slice(2)

if (!skinRootArg || !repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  console.error('usage: node scripts/write-skin-build.mjs <skin-root> <owner/repo>')
  process.exitCode = 2
} else {
  const skinRoot = resolve(skinRootArg)
  const manifestPath = resolve(skinRoot, 'skin.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (typeof manifest.dshCompatibility !== 'string' || !/^\d+\.\d+\.\d+rc\d+$/.test(manifest.dshCompatibility)) {
    throw new Error('skin.json.dshCompatibility must use x.y.zrcN form (for example 0.1.1rc2)')
  }
  // 仓库相对路径必须是真实目录名：身份分离后本 fork 的 skin.json 的 id 带 `-wj` 后缀
  // （maid-atelier-wj），若沿用 id，path 会指向不存在的目录，管理器据此查上游提交会查错。
  const relPath = basename(skinRoot)
  let sourceCommit
  try {
    const candidate = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: skinRoot,
      encoding: 'utf8',
      timeout: 5000,
    }).trim()
    if (/^[0-9a-f]{40}$/.test(candidate)) sourceCommit = candidate
    else console.warn(`skin-build: git reported a HEAD this script cannot use (${candidate}); sourceCommit omitted`)
  } catch (error) {
    // A source archive has no .git and can still produce a valid fingerprint.
    // A real worktree that merely could not reach Git — a sandbox refusing
    // piped stdio, for instance — must not degrade the same silent way: the
    // manifest would ship with no ancestry anchor, and the manager would call
    // every build incomparable instead of offering an update direction.
    if (existsSync(resolve(skinRoot, '..', '.git'))) {
      console.warn(
        `skin-build: .git is present but \`git rev-parse HEAD\` failed (${error.code ?? error.message}); sourceCommit omitted`,
      )
    }
  }
  const inputs = ['lib/client.js', 'lib/index.js', 'cordis.patch.yml', 'skin.json']
  const hash = createHash('sha256')

  for (const input of inputs) {
    const file = resolve(skinRoot, input)
    if (!existsSync(file)) throw new Error(`skin build fingerprint input is missing: ${input}`)
    const normalized = readFileSync(file, 'utf8').replaceAll('\r\n', '\n')
    hash.update(`${input}\0${Buffer.byteLength(normalized)}\0`)
    hash.update(normalized)
  }

  const output = `${JSON.stringify({
    schema: 1,
    fingerprint: hash.digest('hex'),
    ...(sourceCommit === undefined ? {} : { sourceCommit }),
    repository,
    path: relPath,
  }, null, 2)}\n`
  const target = resolve(skinRoot, 'skin.build.json')
  const temporary = `${target}.tmp`
  writeFileSync(temporary, output)
  renameSync(temporary, target)
}
