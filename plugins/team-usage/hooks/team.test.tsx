import { expect, test } from 'claude-code/testing'

const B = (tokens: number) => ({ input: tokens, output: 0, cacheWrite: 0, cacheRead: 0, messages: 1 })
const member = (handle: string, name: string, tokens: number) => ({
  handle, name, seen: Date.now(), today: B(tokens), week: B(tokens), month: B(tokens),
})
const members = [member('aaa', 'Pranav', 27000), member('bbb', 'Shivam', 17000), member('ccc', 'Ketan', 0)]

const BAND = { plugin: 'team-usage', component: 'AbovePrompt', props: { hasSurvey: false } } as const

function stub(on: any, posts: string[]) {
  const store: Record<string, unknown> = {}
  on('clock.now', () => ({ value: Date.now() }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: { command: 'team-usage' } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('ui.render', ($: any, e: any) => { const { Text } = $.ui.resolve(e); return <Text>{''}</Text> })
  on('env.get', () => ({ value: 'shivam' }))
  on('fs.list', () => ({ value: [] }))
  on('store.get', (_: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_: any, e: any) => { store[e.key] = e.value; return { value: undefined } })
  on('http.fetch', (_: any, e: any) => {
    if (e.init?.method === 'POST') {
      posts.push(e.init.body)
      return { value: { status: 200, ok: true, headers: {}, text: '{"you":"bbb"}' } }
    }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ members }) } }
  })
}

test('the chip lists everyone who installed, even with no usage, and expands', async ($, on) => {
  stub(on, [])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await new Promise(r => (globalThis as any).setTimeout(r, 300))

  for (const surface of ['desktop', 'terminal'] as const) {
    const band = await $.ui.mount({ ...BAND, surface } as any)
    expect(await band.find({ type: 'Button', text: /#2\/3/ }), surface + ' collapsed').toBeDefined()
    await (band as any).press({ key: 'toggle' })
    const texts = (await band.findAll({ type: 'Text' })).map((t: any) => t.text)
    for (const want of ['Pranav', 'Shivam', 'Ketan', '← you', 'rename']) {
      expect(texts.some((t: string) => t.includes(want)), surface + ' missing ' + want + ' in ' + JSON.stringify(texts)).toBe(true)
    }
    await (band as any).press({ key: 'toggle' }) // the open state is shared; collapse for the next surface
    await band.unmount()
  }
})

test('a sync sends a random id, your name and your totals, and no token', async ($, on) => {
  const posts: string[] = []
  stub(on, posts)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await new Promise(r => (globalThis as any).setTimeout(r, 300))
  const PANE = { plugin: 'team-usage', component: 'Pane', requestId: 'team-usage', props: { title: 't', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as const
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' } as any)
  const why = (await pane.findAll({ type: 'Text' })).map((t: any) => t.text).join(' // ')
  expect(posts.length, 'no post; pane says: ' + why).toBeGreaterThan(0)
  const sent = JSON.parse(posts[0] ?? '{}')
  expect(sent.id).toMatch(/^[0-9a-f]{32}$/)
  expect(sent.name).toBe('shivam')
  expect(Object.keys(sent.usage)).toEqual(['today', 'week', 'month'])
  expect(posts[0]).not.toContain('Bearer')
})

test('/team-usage name changes the name that is sent', async ($, on) => {
  const posts: string[] = []
  stub(on, posts)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ran = await $.command.run({ command: 'team-usage', args: 'name Pranav K' } as any)
  expect(JSON.stringify(ran)).toContain('Pranav K')
  expect(posts.some(p => JSON.parse(p).name === 'Pranav K')).toBe(true)
})
