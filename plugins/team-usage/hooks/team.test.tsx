import { expect, test } from 'claude-code/testing'

const P = (name: string, cost: number, tokens: number, installed = true, seen = 0) => ({
  name, seen, installed, cost, input: tokens, output: 0, cacheWrite: 0, cacheRead: 0,
})
const people = {
  shivam: P('Shivam', 2.1, 17000, true, Date.now()),
  pranav: P('Pranav', 3.4, 27000),
  ketan: P('Ketan', 0, 0), // installed, no usage yet
}
const team = { you: 'shivam', youName: 'Shivam', nameSet: false, updated: 0, periods: { today: people, week: people, month: people } }

const BAND = { plugin: 'team-usage', component: 'AbovePrompt', props: { hasSurvey: false } } as const

function stub(on: any, posts: string[]) {
  on('clock.every', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: { command: 'team-usage' } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('ui.render', ($: any, e: any) => { const { Text } = $.ui.resolve(e); return <Text>{''}</Text> })
  on('env.get', () => ({ value: '/home/x' }))
  on('fs.read', () => ({ value: JSON.stringify({ env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://t.example', OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer T' } }) }))
  on('http.fetch', (_: any, e: any) => {
    if (e.init?.method === 'POST') posts.push(e.init.body)
    return { value: { status: 200, ok: true, headers: {}, text: e.init?.method === 'POST' ? '{"name":"Pranav K"}' : JSON.stringify(team) } }
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
    for (const want of ['Shivam', 'Pranav', 'Ketan', '← you', 'rename']) {
      expect(texts.some((t: string) => t.includes(want)), surface + ' missing ' + want + ' in ' + JSON.stringify(texts)).toBe(true)
    }
    await (band as any).press({ key: 'toggle' }) // the open state is shared; collapse for the next surface
    await band.unmount()
  }
})

test('/team-usage name saves the name on the server', async ($, on) => {
  const posts: string[] = []
  stub(on, posts)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ran = await $.command.run({ command: 'team-usage', args: 'name Pranav K' } as any)
  expect(posts[0]).toBe('{"name":"Pranav K"}')
  expect(JSON.stringify(ran)).toContain('Pranav K')
})
