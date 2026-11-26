import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Bucket, Member, Team } from '../types'

// The shared team server: it stores only each person's name and token totals.
// If you host your own copy, change this address.
const SERVER = 'https://claudeteamusage.vercel.app'
const SIGN_IN = 'Not signed in. Run: /team-usage login <username> <password>'
const WRONG_LOGIN = 'Wrong team username or password. Run: /team-usage login <username> <password>'
const PANE = 'team-usage'
const ONLINE_MS = 10 * 60 * 1000
const DAY = 864e5
const CHUNK = 3 * 1024 * 1024

const view = atom({ plugin: 'team-usage', key: 'view' } as const, { team: null, error: '' }, {
  shape: 'view-6',
})
const open = atom({ plugin: 'team-usage', key: 'open' } as const, false)
const period = atom({ plugin: 'team-usage', key: 'period' } as const, 'week')

const LABEL = { today: 'Today', week: '7 days', month: '30 days' } as const

const empty = (): Bucket => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, messages: 0 })
const short = (x: number) =>
  x >= 1e6 ? (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? (x / 1e3).toFixed(1) + 'K' : String(Math.round(x))
// tokens = what you and Claude sent and wrote; cache = the context Claude stored and re-read
const fresh = (b: Bucket) => b.input + b.output
const cached = (b: Bucket) => b.cacheWrite + b.cacheRead
// Ranking weight: how much of your plan a person's use consumes. Output costs about 5x input, cache writes 1.25x, cache reads 0.1x.
const weight = (b: Bucket) => b.input + 5 * b.output + 1.25 * b.cacheWrite + 0.1 * b.cacheRead
const shown = (name: string, max: number) => (name.length > max ? name.slice(0, max - 1) + '…' : name)
const bar = (x: number, max: number) => {
  const n = max > 0 && x > 0 ? Math.max(1, Math.round((x / max) * 8)) : 0
  return '▰'.repeat(n) + '▱'.repeat(8 - n)
}
const ranked = (members: Member[], per: 'today' | 'week' | 'month') =>
  [...members].sort((a, b) => weight(b[per]) - weight(a[per]) || a.name.localeCompare(b.name))

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
let lastScan = { root: '', files: 0, today: 0, month: 0 }
async function scan($: any) {
  const home = await $.env.get('HOME')
  const configDir = String((await $.env.get('CLAUDE_CONFIG_DIR')) ?? '') || `${home}/.claude`
  const root = `${configDir}/projects`
  const now = await $.clock.now()
  const out = { today: empty(), week: empty(), month: empty() }
  const seen = new Set<string>()
  const counted = new Set<string>() // the same message can sit in several transcripts (resumed or forked sessions)
  const dirs = await $.fs.list(root).catch((e: any) => {
    throw new Error(`Cannot read ${root}: ${String(e?.message || e)}`)
  })
  // Transcripts: each project's own *.jsonl files, plus the subagent transcripts in <project>/<session>/subagents/.
  // Subagent replies are real usage and are not repeated in the main files.
  const recent = (f: any) => f.kind === 'file' && f.name.endsWith('.jsonl') && now - f.mtimeMs <= 31 * DAY
  const cands: { path: string; size: number; mtimeMs: number }[] = []
  for (const d of dirs) {
    if (d.kind !== 'dir') continue
    const entries = await $.fs.list(`${root}/${d.name}`).catch(() => [])
    for (const f of entries) {
      if (recent(f)) cands.push({ path: `${root}/${d.name}/${f.name}`, size: f.size, mtimeMs: f.mtimeMs })
      else if (f.kind === 'dir') {
        const subs = await $.fs.list(`${root}/${d.name}/${f.name}/subagents`).catch(() => [])
        for (const sf of subs) {
          if (recent(sf)) cands.push({ path: `${root}/${d.name}/${f.name}/subagents/${sf.name}`, size: sf.size, mtimeMs: sf.mtimeMs })
        }
      }
    }
  }
  {
    for (const f of cands) {
      const path = f.path
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
  lastScan = { root, files: seen.size, today: out.today.messages, month: out.month.messages }
  return out
}

const ID_OK = /^[a-zA-Z0-9-]{16,64}$/

// Your id and name live in one small file in ~/.claude, so every copy of the mod on this computer is one person.
async function identity($: any) {
  const home = String((await $.env.get('HOME')) ?? '')
  const user = String((await $.env.get('USER')) ?? '')
  const file = `${home}/.claude/team-usage.json`
  let saved: { id?: string; name?: string; login?: string } = {}
  try {
    saved = JSON.parse(String(await $.fs.read(file)))
  } catch {}
  let id = String(saved.id ?? '')
  let name = String(saved.name ?? '')
  const fromStore = String((await $.store.get('id')) ?? '')
  if (!ID_OK.test(id)) id = ID_OK.test(fromStore) ? fromStore : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  if (!name) name = String((await $.store.get('name')) ?? '') || user || 'anonymous'
  if (saved.id !== id || saved.name !== name) {
    try {
      await $.fs.write(file, JSON.stringify({ ...saved, id, name }))
    } catch {}
  }
  // If this copy used a different id before (its own store id), remember it so the server can drop that old row.
  if (ID_OK.test(fromStore) && fromStore !== id) {
    const had = ((await $.store.get('replaces')) as string[] | undefined) ?? []
    if (!had.includes(fromStore)) await $.store.set('replaces', [...had, fromStore].slice(-3))
  }
  await $.store.set('id', id)
  await $.store.set('name', name)
  return { id, name, fileLogin: String(saved.login ?? '') }
}

// Rewrites the shared file, keeping every other field in it (such as a login put there by a setup prompt).
async function saveFile($: any, change: Record<string, string | undefined>) {
  const home = String((await $.env.get('HOME')) ?? '')
  const file = `${home}/.claude/team-usage.json`
  let saved: Record<string, string | undefined> = {}
  try {
    saved = JSON.parse(String(await $.fs.read(file)))
  } catch {}
  const next = { ...saved, ...change }
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
  try {
    await $.fs.write(file, JSON.stringify(next))
  } catch {}
}

async function saveName($: any, name: string) {
  await identity($)
  await $.store.set('name', name)
  await saveFile($, { name })
}

// One refresh at a time, so two starts at once cannot make two ids.
let running: Promise<void> = Promise.resolve()
async function refresh($: any) {
  running = running.then(() => refreshOnce($))
  return running
}

// Sends your totals, then reads back the whole team.
async function refreshOnce($: any) {
  try {
    const { id, name, fileLogin } = await identity($)
    // The login comes from `/team-usage login`, or from the shared file (so a setup prompt can put it there).
    const login = String((await $.store.get('login')) ?? '') || fileLogin
    const at = login.indexOf(':')
    if (at < 1) throw new Error(SIGN_IN)
    const auth = { 'x-team-user': login.slice(0, at), 'x-team-password': login.slice(at + 1) }
    const usage = await scan($)
    const oldIds = (((await $.store.get('replaces')) as string[] | undefined) ?? []).filter(x => ID_OK.test(x))
    const post = await $.http.fetch(`${SERVER}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ id, name, usage, replaces: oldIds }),
    })
    if (post.status === 401) throw new Error(WRONG_LOGIN)
    if (!post.ok) throw new Error(`The team server answered ${post.status}.`)
    if (oldIds.length) await $.store.set('replaces', [])
    const you = String(JSON.parse(post.text).you)
    const res = await $.http.fetch(`${SERVER}/api/team`, { headers: auth })
    if (res.status === 401) throw new Error(WRONG_LOGIN)
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
      description: "Team usage. '/team-usage login <user> <password>' signs in, '/team-usage name <name>' renames you",
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
      await saveName($, name)
      await refresh($)
      return { text: `Done. Your teammates now see you as "${name}".` }
    }
    const l = args.match(/^login\s+(\S+)\s+(.+)$/i)
    if (l) {
      await $.store.set('login', `${l[1]}:${(l[2] ?? '').trim()}`)
      await saveFile($, { login: undefined })
      await update($, view, () => ({ team: null, error: '' }))
      await refresh($)
      const v = await read($, view)
      return { text: v.team ? 'Signed in. You are now on the team list.' : v.error }
    }
    if (/^debug$/i.test(args)) {
      await refresh($)
      const v = await read($, view)
      const me = v.team?.members.find(m => m.handle === v.team?.you)
      return {
        text: `Reading ${lastScan.root} | transcript files in the last 31 days: ${lastScan.files} | replies counted today: ${lastScan.today}, in 30 days: ${lastScan.month}` +
          (me ? ` | today: ${short(fresh(me.today))} tokens, ${short(cached(me.today))} cache` : '') +
          (v.error ? ` | problem: ${v.error}` : ''),
      }
    }
    if (/^logout$/i.test(args)) {
      await $.store.set('login', '')
      await saveFile($, { login: undefined })
      await update($, view, () => ({ team: null, error: SIGN_IN }))
      return { text: 'Signed out. Your row stays on the server until the team owner removes it.' }
    }
    if (args && args !== 'open') {
      return { text: 'Use /team-usage to open the pane, /team-usage login <username> <password> to sign in, or /team-usage name <your name> to rename.' }
    }
    await $.ui.open({ id: PANE, title: 'Team usage' })
    void refresh($)
    return { text: 'Team usage pane opened.' }
  })

  // The chip above the prompt: one quiet line, click to expand.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const prev = await next(e)
    const v = await read($, view)
    if (e.props.hasSurvey) return prev
    if (!v.team) {
      if (!v.error) return prev
      const { Box: Hb, Text: Ht } = $.ui.resolve(e)
      return (
        <Hb flexDirection="column">
          {prev}
          <Ht dimColor>Team usage: {v.error}</Ht>
        </Hb>
      )
    }
    const team = v.team
    const { Box, Button, Text } = $.ui.resolve(e)
    const isOpen = await read($, open)
    const per = (await read($, period)) as 'today' | 'week' | 'month'
    const list = ranked(team.members, per)
    const mine = list.findIndex(m => m.handle === team.you)
    const me = list[mine]
    const top = Math.max(0, ...list.map(m => weight(m[per])))
    const now = Date.now()

    const label = isOpen
      ? '▾ Team usage'
      : `▸ Team${mine >= 0 ? ` #${mine + 1}/${list.length}` : ''}${me ? ` · ${short(fresh(me[per]))} tokens · ${short(cached(me[per]))} cache` : ''} · ${LABEL[per]}`

    if (!isOpen) {
      return (
        <Box flexDirection="column">
          {prev}
          <Button key="toggle" plain label={label} onPress={() => update($, open, o => !o)} />
        </Box>
      )
    }

    // Few lines: the terminal cuts a tall chip off. Show the top rows and always keep your own row in view.
    const CAP = 5
    let shownRows = list.map((m, i) => ({ m, i }))
    if (shownRows.length > CAP) {
      shownRows = shownRows.slice(0, CAP)
      if (mine >= CAP) shownRows[CAP - 1] = { m: list[mine]!, i: mine }
    }
    const hidden = list.length - shownRows.length

    return (
      <Box flexDirection="column">
        {prev}
        <Box>
          <Button key="toggle" plain label={label} onPress={() => update($, open, o => !o)} />
          <Text dimColor>  {list.length} people</Text>
        </Box>
        <Box>
          <Box width={34}>
            <Box gap={2}>
              {(['today', 'week', 'month'] as const).map(k => (
                <Button key={'p' + k} plain dimColor={k !== per} label={(k === per ? '● ' : '○ ') + LABEL[k]} onPress={() => update($, period, () => k)} />
              ))}
            </Box>
          </Box>
          <Box width={8} justifyContent="flex-end"><Text dimColor>tokens</Text></Box>
          <Box width={9} justifyContent="flex-end"><Text dimColor>cache</Text></Box>
        </Box>
        {shownRows.map(({ m, i }) => {
          const isMe = m.handle === team.you
          const online = now - m.seen < ONLINE_MS
          return (
            <Box key={'r' + m.handle}>
              <Box width={3}><Text dimColor>{String(i + 1)}</Text></Box>
              <Box width={15}><Text bold={isMe} color={isMe ? 'claude' : undefined}>{shown(m.name, 14)}</Text></Box>
              <Box width={10}><Text color="suggestion">{bar(weight(m[per]), top)}</Text></Box>
              <Box width={8} justifyContent="flex-end"><Text>{short(fresh(m[per]))}</Text></Box>
              <Box width={9} justifyContent="flex-end"><Text dimColor>{short(cached(m[per]))}</Text></Box>
              <Box width={3} justifyContent="center"><Text color="success">{online ? '●' : ' '}</Text></Box>
              <Text color="claude">{isMe ? '← you' : ''}</Text>
            </Box>
          )
        })}
        {hidden > 0 && <Text dimColor>  +{hidden} more · /team-usage shows everyone</Text>}
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
            {i + 1}. {shown(m.name, 24)}{m.handle === team.you ? ' (you)' : ''}  {short(fresh(m[per]))} tokens · {short(cached(m[per]))} cache
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
