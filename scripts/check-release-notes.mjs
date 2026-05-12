import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(await readFile(resolve(root, 'public/manifest.json'), 'utf8'))
const changelog = await readFile(resolve(root, 'CHANGELOG.md'), 'utf8')
const version = manifest.version

if (!changelog.includes(`## ${version} -`) && !changelog.includes(`## v${version} -`)) {
  throw new Error(`CHANGELOG.md is missing an entry for version ${version}.`)
}
