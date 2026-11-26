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
  on('env.get', (_: any, e: any) => ({ value: e.name === 'HOME' ? '/home/x' : 'shivam' }))
  on('store.get', (_: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_: any, e: any) => { store[e.key] = e.value; return { value: undefined } })
  on('fs.write', (_: any, e: any) => { writes[e.path] = e.text; return { value: undefined } })
  const line = (id: string, input: number, output: number, ts: number) =>
    JSON.stringify({ type: 'assistant', timestamp: new Date(ts).toISOString(), message: { id, model: 'm', usage: { input_tokens: input, output_tokens: output, cache_creation_input_tokens: 100, cache_read_input_tokens: 9999 } }, text: 'SECRET PROMPT' })
  const transcript = [line('m1', 1000, 200, Date.now() - 1000), line('m1', 1000, 200, Date.now() - 900), line('m2', 500, 50, Date.now() - 5 * 864e5), 'not json'].join('\n')
  on('fs.list', (_: any, e: any) => ({
    value: e.path === FOLDER
      ? Object.entries(others).map(([name, t]) => ({ name, kind: 'file', size: t.length, mtimeMs: 0, isLink: false }))
      : e.path === '/home/x/.claude/projects'
        ? [{ name: 'proj', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }]
        : e.path === '/home/x/.claude/projects/proj'
          ? [{ name: 's.jsonl', kind: 'file', size: transcript.length, mtimeMs: Date.now(), isLink: false }]
          : [],
  }))
  on('fs.read', (_: any, e: any) => {
    reads.push(e.path)
    return { value: String(e.path).endsWith('s.jsonl') ? transcript : others[String(e.path).split('/').pop() ?? ''] ?? '' }
  })
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
    expect(await band.find({ type: 'Button', text: /#2\/4/ }), surface + ' collapsed').toBeDefined()
    await (band as any).press({ key: 'toggle' })
    const texts = (await band.findAll({ type: 'Text' })).map((t: any) => t.text)
    for (const want of ['Pranav', 'Ketan', 'shivam', '← you', 'scriptEvilscr']) {
      expect(texts.some((t: string) => t.includes(want)), surface + ' missing ' + want + ' in ' + JSON.stringify(texts)).toBe(true)
    }
    expect(texts.some((t: string) => t.includes('<'.concat('script'))), 'html survived').toBe(false)
    await (band as any).press({ key: 'toggle' })
    await band.unmount()
  }
  expect(reads.filter(p => !p.endsWith('s.jsonl')).every(p => /claude-usage-[a-f0-9]{12}\.json$/.test(p)), 'read an unrelated file: ' + reads.join()).toBe(true)
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
  // the transcript has m1 twice (counted once) and m2 five days ago: 1000+200+100, then +500+50+100 in the week
  expect(j.today.input + j.today.output + j.today.cacheWrite).toBe(1300)
  expect(j.week.input + j.week.output + j.week.cacheWrite).toBe(1950)
  expect(j.week.cacheRead).toBe(19998)
  expect(text).not.toContain('SECRET')
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
