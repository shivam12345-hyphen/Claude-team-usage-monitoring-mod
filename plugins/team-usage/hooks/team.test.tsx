import { expect, test } from 'claude-code/testing'

const B = (tokens: number) => ({ input: tokens, output: 0, cacheWrite: 0, cacheRead: 0, messages: 1 })
const member = (handle: string, name: string, tokens: number) => ({
  handle, name, seen: Date.now(), today: B(tokens), week: B(tokens), month: B(tokens),
})
const members = [member('aaa', 'Pranav', 27000), member('bbb', 'Shivam', 1950), member('ccc', 'Ketan', 0)]

const BAND = { plugin: 'team-usage', component: 'AbovePrompt', props: { hasSurvey: false } } as const

const line = (id: string, input: number, output: number, ts: number) =>
  JSON.stringify({
    type: 'assistant', timestamp: new Date(ts).toISOString(), text: 'SECRET PROMPT',
    message: { id, model: 'm', usage: { input_tokens: input, output_tokens: output, cache_creation_input_tokens: 100, cache_read_input_tokens: 9999 } },
  })
const transcript = [line('m1', 1000, 200, Date.now() - 1000), line('m1', 1000, 200, Date.now() - 900), line('m2', 500, 50, Date.now() - 5 * 864e5), 'not json'].join('\n')

function stub(on: any, posts: string[]) {
  const store: Record<string, unknown> = {}
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
  on('fs.list', (_: any, e: any) => ({
    value: e.path === '/home/x/.claude/projects'
      ? [{ name: 'proj', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }]
      : e.path === '/home/x/.claude/projects/proj'
        ? [{ name: 's.jsonl', kind: 'file', size: transcript.length, mtimeMs: Date.now(), isLink: false }]
        : [],
  }))
  on('fs.read', () => ({ value: transcript }))
  on('http.fetch', (_: any, e: any) => {
    if (e.init?.method === 'POST') {
      posts.push(e.init.body)
      return { value: { status: 200, ok: true, headers: {}, text: '{"you":"bbb"}' } }
    }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ members }) } }
  })
}

const wait = () => new Promise(r => (globalThis as any).setTimeout(r, 300))

test('the chip lists everyone who installed, even with no usage, and expands', async ($, on) => {
  stub(on, [])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await wait()
  for (const surface of ['desktop', 'terminal'] as const) {
    const band = await $.ui.mount({ ...BAND, surface } as any)
    expect(await band.find({ type: 'Button', text: /#2\/3/ }), surface + ' collapsed').toBeDefined()
    await (band as any).press({ key: 'toggle' })
    const texts = (await band.findAll({ type: 'Text' })).map((t: any) => t.text)
    for (const want of ['Pranav', 'Shivam', 'Ketan', '← you', 'team-usage name']) {
      expect(texts.some((t: string) => t.includes(want)), surface + ' missing ' + want + ' in ' + JSON.stringify(texts)).toBe(true)
    }
    await (band as any).press({ key: 'toggle' })
    await band.unmount()
  }
})

test('a sync sends only a random id, a name and token totals, never any text', async ($, on) => {
  const posts: string[] = []
  stub(on, posts)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await wait()
  const body = posts[0] ?? '{}'
  const sent = JSON.parse(body)
  expect(Object.keys(sent).sort()).toEqual(['id', 'name', 'usage'])
  expect(sent.id).toMatch(/^[0-9a-f]{32}$/)
  expect(sent.name).toBe('shivam')
  // m1 appears twice (counted once) and m2 is five days old: 1000+200+100 today, +500+50+100 in the week
  expect(sent.usage.today.input + sent.usage.today.output + sent.usage.today.cacheWrite).toBe(1300)
  expect(sent.usage.week.input + sent.usage.week.output + sent.usage.week.cacheWrite).toBe(1950)
  expect(sent.usage.week.cacheRead).toBe(19998)
  expect(body).not.toContain('SECRET')
})

test('/team-usage name changes the name that is sent', async ($, on) => {
  const posts: string[] = []
  stub(on, posts)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ran = await $.command.run({ command: 'team-usage', args: 'name Pranav K' } as any)
  expect(JSON.stringify(ran)).toContain('Pranav K')
  expect(posts.some(p => JSON.parse(p).name === 'Pranav K')).toBe(true)
})
