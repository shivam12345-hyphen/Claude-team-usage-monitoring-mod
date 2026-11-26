import { expect, test } from 'claude-code/testing'

const B = (tokens: number) => ({ input: tokens, output: 0, cacheWrite: 0, cacheRead: 0, messages: 1 })
const file = (name: string, tokens: number) =>
  JSON.stringify({ v: 1, name, seen: Date.now(), today: B(tokens), week: B(tokens), month: B(tokens) })

const FOLDER = '/team'
const others: Record<string, string> = {
  'claude-usage-aaaaaaaaaaaa.json': file('Pranav', 27000),
  'claude-usage-bbbbbbbbbbbb.json': file('Ketan', 0),
  'claude-usage-cccccccccccc.json': file('<script>Evil</script>', 5), // hostile name is cleaned
  'claude-usage-dddddddddddd.json': '{not json', // ignored
  'notes.txt': 'secrets', // never read
}

const BAND = { plugin: 'team-usage', component: 'AbovePrompt', props: { hasSurvey: false } } as const

function stub(on: any, writes: Record<string, string>, reads: string[], folder = FOLDER) {
  const store: Record<string, unknown> = folder ? { folder } : {}
  on('clock.now', () => ({ value: Date.now() }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: { command: 'team-usage' } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('ui.render', ($: any, e: any) => { const { Text } = $.ui.resolve(e); return <Text>{''}</Text> })
  on('env.get', () => ({ value: 'shivam' }))
  on('store.get', (_: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_: any, e: any) => { store[e.key] = e.value; return { value: undefined } })
  on('fs.write', (_: any, e: any) => { writes[e.path] = e.text; return { value: undefined } })
  on('fs.list', (_: any, e: any) => ({
    value: e.path === FOLDER
      ? Object.entries(others).map(([name, t]) => ({ name, kind: 'file', size: t.length, mtimeMs: 0, isLink: false }))
      : [],
  }))
  on('fs.read', (_: any, e: any) => { reads.push(e.path); return { value: others[String(e.path).split('/').pop() ?? ''] ?? '' } })
}

const wait = () => new Promise(r => (globalThis as any).setTimeout(r, 300))

test('everyone with a file in the shared folder is listed, hostile files are cleaned', async ($, on) => {
  const writes: Record<string, string> = {}
  const reads: string[] = []
  stub(on, writes, reads)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await wait()

  for (const surface of ['desktop', 'terminal'] as const) {
    const band = await $.ui.mount({ ...BAND, surface } as any)
    expect(await band.find({ type: 'Button', text: /#4\/4/ }), surface + ' collapsed').toBeDefined()
    await (band as any).press({ key: 'toggle' })
    const texts = (await band.findAll({ type: 'Text' })).map((t: any) => t.text)
    for (const want of ['Pranav', 'Ketan', 'shivam', '← you', 'scriptEvilscr']) {
      expect(texts.some((t: string) => t.includes(want)), surface + ' missing ' + want + ' in ' + JSON.stringify(texts)).toBe(true)
    }
    expect(texts.some((t: string) => t.includes('<'.concat('script'))), 'html survived').toBe(false)
    await (band as any).press({ key: 'toggle' })
    await band.unmount()
  }
  expect(reads.every(p => /claude-usage-[a-f0-9]{12}\.json$/.test(p)), 'read an unrelated file: ' + reads.join()).toBe(true)
})

test('my file holds only a name and token totals', async ($, on) => {
  const writes: Record<string, string> = {}
  stub(on, writes, [])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await wait()
  const [path, text] = Object.entries(writes)[0] ?? ['', '']
  expect(path).toMatch(/^\/team\/claude-usage-[a-f0-9]{12}\.json$/)
  const j = JSON.parse(text)
  expect(Object.keys(j).sort()).toEqual(['month', 'name', 'seen', 'today', 'v', 'week'])
  expect(j.name).toBe('shivam')
})

test('with no folder set nothing is written and the chip says so', async ($, on) => {
  const writes: Record<string, string> = {}
  stub(on, writes, [], '')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await wait()
  expect(Object.keys(writes)).toEqual([])
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' } as any)
  await (band as any).press({ key: 'toggle' })
  const texts = (await band.findAll({ type: 'Text' })).map((t: any) => t.text)
  expect(texts.some((t: string) => t.includes('/team-usage folder'))).toBe(true)
  await band.unmount()
})
