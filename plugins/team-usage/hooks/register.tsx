import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Bucket, Member, Team } from '../types'

// Sharing happens through one folder the whole team already syncs (Drive, Dropbox, iCloud...).
// Each install writes ONE small file there with only a name and token totals, and reads the others.
const FILE = /^claude-usage-[a-f0-9]{12}\.json$/
const STALE_MS = 35 * DAY_MS()
const PANE = 'team-usage'
const ONLINE_MS = 10 * 60 * 1000
const DAY = 864e5
function DAY_MS() { return 864e5 }
const CHUNK = 3 * 1024 * 1024

const view = atom({ plugin: 'team-usage', key: 'view' } as const, { team: null, error: '' }, {
  shape: 'view-4',
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
  const dirs = await $.fs.list(root).catch(() => [])
  for (const d of dirs) {
    if (d.kind !== 'directory') continue
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
      for (const m of entry.msgs.values()) {
        const age = now - m.t
        if (age > 30 * DAY) continue
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

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.min(x, 1e12) : 0)
const cleanBucket = (b: any): Bucket => ({
  input: num(b?.input), output: num(b?.output), cacheWrite: num(b?.cacheWrite), cacheRead: num(b?.cacheRead), messages: num(b?.messages),
})

// Files other people wrote are untrusted: only numbers and a short plain name are ever taken from them.
function readMember(handle: string, text: string, now: number): Member | null {
  try {
    const j = JSON.parse(text)
    const seen = typeof j?.seen === 'number' && Number.isFinite(j.seen) && j.seen > 0 && j.seen <= now + DAY ? j.seen : 0
    if (!seen || now - seen > STALE_MS) return null
    const name = String(j?.name ?? '').replace(/[^\p{L}\p{N} ._'-]/gu, '').trim().slice(0, 24) || 'anonymous'
    return { handle, name, seen, today: cleanBucket(j.today), week: cleanBucket(j.week), month: cleanBucket(j.month) }
  } catch {
    return null
  }
}

async function folderPath($: any): Promise<string> {
  const raw = String((await $.store.get('folder')) ?? '')
  if (!raw) return ''
  const home = await $.env.get('HOME')
  return raw.replace(/^~(?=\/|$)/, String(home ?? '')).replace(/\/+$/, '')
}

// Measures your usage, publishes your one file, reads everyone else's.
async function refresh($: any) {
  try {
    const { id, name } = await identity($)
    const handle = id.slice(0, 12)
    const usage = await scan($)
    const now = await $.clock.now()
    const me: Member = { handle, name, seen: now, ...usage }
    const members: Member[] = [me]
    const folder = await folderPath($)
    let error = ''
    if (folder) {
      try {
        await $.fs.write(`${folder}/claude-usage-${handle}.json`, JSON.stringify({ v: 1, name, seen: now, ...usage }))
        const entries = await $.fs.list(folder)
        for (const f of entries) {
          if (f.kind !== 'file' || !FILE.test(f.name) || f.size > 20000) continue
          const other = f.name.slice('claude-usage-'.length, -'.json'.length)
          if (other === handle) continue
          const text = await $.fs.read(`${folder}/${f.name}`).catch(() => '')
          const m = readMember(other, String(text), now)
          if (m) members.push(m)
        }
      } catch (e: any) {
        error = `Shared folder problem: ${String(e?.message || e)}`
      }
    }
    const team: Team = { you: handle, members, shared: Boolean(folder) }
    await update($, view, () => ({ team, error }))
    const list = ranked(members, 'week')
    const rank = list.findIndex(m => m.handle === handle) + 1
    $.ui.status(folder ? `Team #${rank}/${list.length} this week` : 'Team usage: set a shared folder')
  } catch (e: any) {
    await update($, view, v => ({ ...v, error: String(e?.message || e) }))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'team-usage',
      description: "Team usage. '/team-usage folder <path>' picks the shared folder, '/team-usage name <name>' renames you",
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
    const f = args.match(/^folder\s+(.+)$/i)
    if (f) {
      const path = (f[1] ?? '').trim().replace(/^["']|["']$/g, '')
      await $.store.set('folder', path)
      await refresh($)
      const v = await read($, view)
      return { text: v.error ? v.error : `Shared folder set to ${path}. Your teammates appear once they set the same folder.` }
    }
    if (args && args !== 'open') {
      return { text: 'Use /team-usage to open the pane, /team-usage name <your name> to rename, or /team-usage folder <path> to choose the shared team folder.' }
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
        <Text dimColor>{team.shared ? '● online now · new tokens (cache excluded) · /team-usage name <your name>' : 'Alone for now. Share a team folder: /team-usage folder <path>'}</Text>
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
