import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'

await rm('lib', { recursive: true, force: true })
await mkdir('lib', { recursive: true })
await cp('src', 'lib', { recursive: true })
await rm('lib/app', { recursive: true, force: true })

const clientResult = await Bun.build({
  entrypoints: ['src/client.js'],
  target: 'browser',
  format: 'cjs',
  external: [
    'react',
    'react/jsx-runtime',
    '@deepseek-ai/dsh-client-ui-primitives',
  ],
})
if (!clientResult.success || clientResult.outputs.length !== 1) {
  for (const log of clientResult.logs) console.error(log)
  throw new Error('Unable to build the DeepDeck Client bundle')
}
const client = await clientResult.outputs[0].text()
const banner = 'window.__ModuleLoader__.load({ id: "@deepdeck-apps/video-sherlock-app", factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;\n'
const footer = '\nreturn module.exports; } });\n'
await writeFile('lib/client.js', banner + client + footer)

const appResult = await Bun.build({
  entrypoints: ['src/app/main.tsx'],
  target: 'browser',
  format: 'esm',
  outdir: 'lib',
  naming: 'app.[ext]',
  minify: true,
})
if (!appResult.success) {
  for (const log of appResult.logs) console.error(log)
  throw new Error('Unable to build the Video Sherlock React App')
}

await Promise.all([
  readFile('lib/client.d.ts'),
  readFile('lib/app.js'),
  readFile('lib/app.css'),
])
console.log('Built DeepDeck Host, Client slots, and React App bundles')
