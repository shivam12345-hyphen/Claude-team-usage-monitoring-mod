import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Bucket, Member, Team } from '../types'

// The shared team server: it stores only each person's name and token totals.
// If you host your own copy, change this address.
const SERVER = 'https://claudeteamusage.vercel.app'
const PANE = 'team-usage'
const ONLINE_MS = 10 * 60 * 1000
const DAY = 864e5
const CHUNK = 3 * 1024 * 1024

const view = atom({ plugin: 'team-usage', key: 'view' } as const, { team: null, error: '' }, {
  shape: 'view-5',
})
const open = atom({ plugin: 'team-usage', key: 'open' } as const, false)
const period = atom({ plugin: 'team-usage', key: 'period' } as const, 'week')

const LABEL = { today: 'Today', week: '7 days', month: '30 days' } as const

const empty = (): Bucket => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, messages: 0 })
const short = (x: number) =>
  x >= 1e6 ? (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? (x / 1e3).toFixed(1) + 'K' : String(Math.round(x))
const fresh = (b: Bucket) => b.input + b.output + b.cacheWrite
const shown = (name: string, max: number) => (name.length > max ? name.slice(0, max - 1) + '…' : name)
const bar = (x: number, max: number) => {
  const n = max > 0 && x > 0 ? Math.max(1, Math.round((x / max) * 8)) : 0
  return '▰'.repeat(n) + '▱'.repeat(8 - n)
}
const ranked = (members: Member[], per: 'today' | 'week' | 'month') =>
  [...members].sort((a, b) => fresh(b[per]) - fresh(a[per]) || a.name.localeCompare(b.name))

type Msg = { t: number; i: number; o: number; cw: number; cr: number }
// Per transcript file: the last-seen usage of each assistant message, kept until the file changes.
const files = new Map<string, { sig: string; msgs: Map<string, Msg> }>()

function parseLine(line: string, into: Map<string, Msg>) {
  if (!line.includes('"usage"')) return
  try {
    const j = JSON.parse(line)
    const m = j.message
    if (j.type !== 'assistant' || !m?.usage) return
    const u = m.usage
    const id = String(m.id || j.uuid || into.size) + '|' + String(j.requestId || '')
    into.set(id, {
      t: Date.parse(j.timestamp) || 0,
      i: u.input_tokens || 0,
      o: u.output_tokens || 0,
      cw: u.cache_creation_input_tokens || 0,
      cr: u.cache_read_input_tokens || 0,
    })
  } catch {}
}

// Your own usage, summed from the transcripts Claude Code keeps on this computer.
async function scan($: any) {
  const home = await $.env.get('HOME')
  const root = `${home}/.claude/projects`
  const now = await $.clock.now()
  const out = { today: empty(), week: empty(), month: empty() }
  const seen = new Set<string>()
  const counted = new Set<string>() // the same message can sit in several transcripts (resumed or forked sessions)
  const dirs = await $.fs.list(root).catch((e: any) => {
    throw new Error(`Cannot read ${root}: ${String(e?.message || e)}`)
  })
  for (const d of dirs) {
    if (d.kind !== 'dir') continue
    const entries = await $.fs.list(`${root}/${d.name}`).catch(() => [])
    for (const f of entries) {
      if (f.kind !== 'file' || !f.name.endsWith('.jsonl') || now - f.mtimeMs > 31 * DAY) continue
      const path = `${root}/${d.name}/${f.name}`
      seen.add(path)
      const sig = `${f.mtimeMs}:${f.size}`
      let entry = files.get(path)
      if (!entry || entry.sig !== sig) {
        const msgs = new Map<string, Msg>()
        let carry = ''
        for (let off = 0; off < f.size; off += CHUNK) {
          const text = carry + (await $.fs.read(path, { offset: off, length: CHUNK }))
          const lines = text.split('\n')
          carry = lines.pop() ?? ''
          for (const l of lines) parseLine(l, msgs)
        }
        parseLine(carry, msgs)
        entry = { sig, msgs }
        files.set(path, entry)
      }
      for (const [key, m] of entry.msgs) {
        const age = now - m.t
        if (age > 30 * DAY || counted.has(key)) continue
        counted.add(key)
        const add = (b: Bucket) => {
          b.input += m.i; b.output += m.o; b.cacheWrite += m.cw; b.cacheRead += m.cr; b.messages += 1
        }
        add(out.month)
        if (age <= 7 * DAY) add(out.week)
        if (age <= DAY) add(out.today)
      }
    }
  }
  for (const p of [...files.keys()]) if (!seen.has(p)) files.delete(p)
  return out
}

async function identity($: any) {
  let id = String((await $.store.get('id')) ?? '')
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(id)) {
    id = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
    await $.store.set('id', id)
  }
  let name = String((await $.store.get('name')) ?? '')
  if (!name) {
    name = String((await $.env.get('USER')) ?? '') || 'anonymous'
    await $.store.set('name', name)
  }
  return { id, name }
}

// Sends your totals, then reads back the whole team.
async function refresh($: any) {
  try {
    const { id, name } = await identity($)
    const usage = await scan($)
    const post = await $.http.fetch(`${SERVER}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, usage }),
    })
    if (!post.ok) throw new Error(`The team server answered ${post.status}.`)
    const you = String(JSON.parse(post.text).you)
    const res = await $.http.fetch(`${SERVER}/api/team`)
    if (!res.ok) throw new Error(`The team server answered ${res.status}.`)
    const members: Member[] = JSON.parse(res.text).members
    await update($, view, () => ({ team: { you, members, shared: true }, error: '' }))
    const list = ranked(members, 'week')
    const rank = list.findIndex(m => m.handle === you) + 1
    $.ui.status(rank ? `Team #${rank}/${list.length} this week` : 'Team usage')
  } catch (e: any) {
    await update($, view, v => ({ ...v, error: String(e?.message || e) }))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'team-usage',
      description: "Team usage. '/team-usage name <your name>' sets the name others see",
    })
    void $.ui.open({ id: PANE, title: 'Team usage' })
    void refresh($)
    $.clock.every(60000, () => void refresh($))
    return next(e)
  })

  on('command.run', { command: 'team-usage' }, async ($, e) => {
    const args = e.args.trim()
    const m = args.match(/^name\s+(.+)$/i)
    if (m) {
      const name = (m[1] ?? '').trim().slice(0, 24)
      await $.store.set('name', name)
      await refresh($)
      return { text: `Done. Your teammates now see you as "${name}".` }
    }
    if (args && args !== 'open') {
      return { text: 'Use /team-usage to open the pane, or /team-usage name <your name> to change your name.' }
    }
    await $.ui.open({ id: PANE, title: 'Team usage' })
    void refresh($)
    return { text: 'Team usage pane opened.' }
  })

  // The chip above the prompt: one quiet line, click to expand.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const prev = await next(e)
    const v = await read($, view)
    if (!v.team || e.props.hasSurvey) return prev
    const team = v.team
    const { Box, Button, Text } = $.ui.resolve(e)
    const isOpen = await read($, open)
    const per = (await read($, period)) as 'today' | 'week' | 'month'
    const list = ranked(team.members, per)
    const mine = list.findIndex(m => m.handle === team.you)
    const me = list[mine]
    const top = Math.max(0, ...list.map(m => fresh(m[per])))
    const now = Date.now()

    const label = isOpen
      ? '▾ Team usage'
      : `▸ Team${mine >= 0 ? ` #${mine + 1}/${list.length}` : ''}${me ? ` · ${short(fresh(me[per]))}` : ''} · ${LABEL[per]}`

    if (!isOpen) {
      return (
        <Box flexDirection="column">
          {prev}
          <Button key="toggle" plain label={label} onPress={() => update($, open, o => !o)} />
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor="promptBorder">
        {prev}
        <Box>
          <Button key="toggle" plain label={label} onPress={() => update($, open, o => !o)} />
          <Text dimColor>  {list.length} on the team</Text>
        </Box>
        <Box gap={2}>
          {(['today', 'week', 'month'] as const).map(k => (
            <Button key={'p' + k} plain dimColor={k !== per} label={(k === per ? '● ' : '○ ') + LABEL[k]} onPress={() => update($, period, () => k)} />
          ))}
        </Box>
        {list.map((m, i) => {
          const isMe = m.handle === team.you
          const online = now - m.seen < ONLINE_MS
          return (
            <Box key={'r' + m.handle}>
              <Box width={3}><Text dimColor>{String(i + 1)}</Text></Box>
              <Box width={15}><Text bold={isMe} color={isMe ? 'claude' : undefined}>{shown(m.name, 14)}</Text></Box>
              <Box width={10}><Text color="suggestion">{bar(fresh(m[per]), top)}</Text></Box>
              <Box width={9} justifyContent="flex-end"><Text>{short(fresh(m[per]))}</Text></Box>
              <Box width={3} justifyContent="center"><Text color="success">{online ? '●' : ' '}</Text></Box>
              <Text color="claude">{isMe ? '← you' : ''}</Text>
            </Box>
          )
        })}
        <Text dimColor>{v.error ? 'Offline: ' + v.error : '● online now · new tokens (cache excluded) · /team-usage name <your name>'}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const v = await read($, view)
    if (!v.team) return <Text dimColor>{v.error || 'Loading team usage…'}</Text>
    const team = v.team
    const section = (label: string, per: 'today' | 'week' | 'month') => (
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>{label}</Text>
        {ranked(team.members, per).map((m, i) => (
          <Text bold={m.handle === team.you}>
            {i + 1}. {shown(m.name, 24)}{m.handle === team.you ? ' (you)' : ''}  {short(fresh(m[per]))} tokens
          </Text>
        ))}
      </Box>
    )
    return (
      <Box flexDirection="column">
        {section('Today', 'today')}
        {section('Last 7 days', 'week')}
        {section('Last 30 days', 'month')}
        {v.error && <Text dimColor>Last refresh failed: {v.error}</Text>}
      </Box>
    )
  })
}
