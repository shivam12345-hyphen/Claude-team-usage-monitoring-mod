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

function stub(on: any, posts: string[], opts: { login?: string; password?: string; fetches?: any[]; files?: Record<string, string>; team?: any[] } = {}) {
  const files = opts.files ?? {}
  const store: Record<string, unknown> = 'login' in opts ? (opts.login ? { login: opts.login } : {}) : { login: 'teamuser:test-only-pass' }
  const password = opts.password ?? 'test-only-pass'
  on('clock.now', () => ({ value: Date.now() }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: { command: 'team-usage' } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('ui.render', ($: any, e: any) => { const { Text } = $.ui.resolve(e); return <Text>{''}</Text> })
  on('env.get', (_: any, e: any) => ({ value: e.name === 'HOME' ? '/home/x' : e.name === 'USER' ? 'shivam' : undefined }))
  on('store.get', (_: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_: any, e: any) => { store[e.key] = e.value; return { value: undefined } })
  on('fs.list', (_: any, e: any) => ({
    value: e.path === '/home/x/.claude/projects'
      ? [{ name: 'proj', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }]
      : e.path === '/home/x/.claude/projects/proj'
        ? [{ name: 's.jsonl', kind: 'file', size: transcript.length, mtimeMs: Date.now(), isLink: false }]
        : [],
  }))
  on('fs.write', (_: any, e: any) => { files[e.path] = e.text; return { value: undefined } })
  on('fs.read', (_: any, e: any) => ({ value: String(e.path).endsWith('team-usage.json') ? files[e.path] ?? '' : transcript }))
  on('http.fetch', (_: any, e: any) => {
    opts.fetches?.push(e)
    if (e.init?.headers?.['x-team-password'] !== password) {
      return { value: { status: 401, ok: false, headers: {}, text: '{"error":"wrong team username or password"}' } }
    }
    if (e.init?.method === 'POST') {
      posts.push(e.init.body)
      return { value: { status: 200, ok: true, headers: {}, text: '{"you":"bbb"}' } }
    }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ members: opts.team ?? members }) } }
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

test('without a login nothing is sent and the chip says how to sign in', async ($, on) => {
  const fetches: any[] = []
  stub(on, [], { login: '', fetches })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await wait()
  expect(fetches).toEqual([])
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' } as any)
  const texts = (await band.findAll({ type: 'Text' })).map((t: any) => t.text)
  expect(texts.some((t: string) => t.includes('/team-usage login'))).toBe(true)
  await band.unmount()
})

test('every request carries the team login, and a wrong password shows how to fix it', async ($, on) => {
  const fetches: any[] = []
  stub(on, [], { login: 'teamuser:wrong', fetches })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await wait()
  expect(fetches.length).toBeGreaterThan(0)
  expect(fetches.every(f => f.init.headers['x-team-user'] === 'teamuser')).toBe(true)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' } as any)
  const texts = (await band.findAll({ type: 'Text' })).map((t: any) => t.text)
  expect(texts.some((t: string) => t.includes('Wrong team username or password'))).toBe(true)
  await band.unmount()
})

test('/team-usage login saves the login and joins the team', async ($, on) => {
  const fetches: any[] = []
  stub(on, [], { login: '', fetches })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const bad = await $.command.run({ command: 'team-usage', args: 'login teamuser nope' } as any)
  expect(JSON.stringify(bad)).toContain('Wrong team username or password')
  const good = await $.command.run({ command: 'team-usage', args: 'login teamuser test-only-pass' } as any)
  expect(JSON.stringify(good)).toContain('Signed in')
})

test('every copy of the mod on one computer is one person (shared id file)', async ($, on) => {
  const posts: string[] = []
  const files: Record<string, string> = { '/home/x/.claude/team-usage.json': JSON.stringify({ id: 'f'.repeat(32), name: 'Shivam K' }) }
  stub(on, posts, { files })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await wait()
  const sent = JSON.parse(posts[0] ?? '{}')
  expect(sent.id).toBe('f'.repeat(32))
  expect(sent.name).toBe('Shivam K')
})

test('a first run creates the id file, and a rename updates it', async ($, on) => {
  const posts: string[] = []
  const files: Record<string, string> = {}
  stub(on, posts, { files })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await wait()
  const file = '/home/x/.claude/team-usage.json'
  expect(JSON.parse(files[file] ?? '{}').id).toBe(JSON.parse(posts[0] ?? '{}').id)
  await $.command.run({ command: 'team-usage', args: 'name Pranav K' } as any)
  expect(JSON.parse(files[file] ?? '{}').name).toBe('Pranav K')
})

test('/team-usage debug says what was read', async ($, on) => {
  stub(on, [])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await wait()
  const ran = JSON.stringify(await $.command.run({ command: 'team-usage', args: 'debug' } as any))
  expect(ran).toContain('/home/x/.claude/projects')
  expect(ran).toContain('transcript files')
  expect(ran).toContain('replies counted today: 1')
})

test('the ranking follows plan use, not just input and output', async ($, on) => {
  // A has more input+output; B has far more cache reads and output-heavy work, so B ranks higher.
  const heavy = { input: 100, output: 50000, cacheWrite: 1000000, cacheRead: 100000000, messages: 5 }
  const light = { input: 90000, output: 1000, cacheWrite: 0, cacheRead: 0, messages: 5 }
  const mk = (handle: string, name: string, b: any) => ({ handle, name, seen: Date.now(), today: b, week: b, month: b })
  const list = [mk('a', 'Light', light), mk('b', 'Heavy', heavy)]
  stub(on, [], { team: list })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await wait()
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' } as any)
  await (band as any).press({ key: 'toggle' })
  const texts = (await band.findAll({ type: 'Text' })).map((t: any) => t.text)
  expect(texts.indexOf('Heavy')).toBeLessThan(texts.indexOf('Light'))
  await band.unmount()
})

test('a login placed in the shared file signs you in, and a rename keeps it', async ($, on) => {
  const fetches: any[] = []
  const file = '/home/x/.claude/team-usage.json'
  const files: Record<string, string> = { [file]: JSON.stringify({ login: 'teamuser:test-only-pass' }) }
  stub(on, [], { login: '', fetches, files })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await wait()
  expect(fetches.length).toBeGreaterThan(0)
  expect(fetches.every(f => f.init.headers['x-team-user'] === 'teamuser')).toBe(true)
  expect(JSON.parse(files[file] ?? '{}').login).toBe('teamuser:test-only-pass')
  await $.command.run({ command: 'team-usage', args: 'name Pranav K' } as any)
  const after = JSON.parse(files[file] ?? '{}')
  expect(after.name).toBe('Pranav K')
  expect(after.login).toBe('teamuser:test-only-pass')
})

test('logout removes the login from the file too', async ($, on) => {
  const file = '/home/x/.claude/team-usage.json'
  const files: Record<string, string> = { [file]: JSON.stringify({ login: 'teamuser:test-only-pass' }) }
  stub(on, [], { login: '', files })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await wait()
  await $.command.run({ command: 'team-usage', args: 'logout' } as any)
  expect(JSON.parse(files[file] ?? '{}').login).toBeUndefined()
})
