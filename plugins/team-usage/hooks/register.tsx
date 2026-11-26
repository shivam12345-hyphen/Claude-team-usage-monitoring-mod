import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Person, Team } from '../types'

const PANE = 'team-usage'
const ONLINE_MS = 10 * 60 * 1000

const view = atom({ plugin: 'team-usage', key: 'view' } as const, { team: null, error: '' }, {
  shape: 'view-2',
})
const open = atom({ plugin: 'team-usage', key: 'open' } as const, false)
const period = atom({ plugin: 'team-usage', key: 'period' } as const, 'week')

const MEDAL = ['🥇', '🥈', '🥉']
const LABEL = { today: 'Today', week: '7 days', month: '30 days' } as const

const short = (x: number) =>
  x >= 1e6 ? (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? (x / 1e3).toFixed(1) + 'K' : String(Math.round(x))
const fresh = (p: Person) => p.input + p.output + p.cacheWrite
const money = (x: number) => '$' + x.toFixed(2)
const bar = (x: number, max: number) => {
  const n = max > 0 && x > 0 ? Math.max(1, Math.round((x / max) * 8)) : 0
  return '▰'.repeat(n) + '▱'.repeat(8 - n)
}
const ranked = (people: Record<string, Person>) =>
  Object.entries(people).sort((a, b) => b[1].cost - a[1].cost || a[1].name.localeCompare(b[1].name))

// Reads the dashboard address and your personal token from the settings the setup script wrote.
async function connection($: any) {
  const home = await $.env.get('HOME')
  let raw = ''
  try {
    raw = await $.fs.read(`${home}/.claude/settings.json`)
  } catch {
    throw new Error('Could not read ~/.claude/settings.json. Run the team setup script first.')
  }
  const env = JSON.parse(raw).env || {}
  const endpoint = String(env.OTEL_EXPORTER_OTLP_ENDPOINT || '').replace(/\/+$/, '')
  const auth = String(env.OTEL_EXPORTER_OTLP_HEADERS || '').replace(/^Authorization=/, '')
  if (!endpoint || !auth) throw new Error('Team setup not found. Run the setup script first.')
  return { endpoint, auth }
}

async function load($: any): Promise<Team> {
  const { endpoint, auth } = await connection($)
  const res = await $.http.fetch(`${endpoint}/api/usage`, { headers: { Authorization: auth } })
  if (res.status === 401) throw new Error('Your token was not accepted. Ask for a new personal token.')
  if (!res.ok) throw new Error(`The team server answered ${res.status}.`)
  return JSON.parse(res.text)
}

async function rename($: any, name: string): Promise<string> {
  const { endpoint, auth } = await connection($)
  const res = await $.http.fetch(`${endpoint}/api/me`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(`Could not save the name (${res.status}).`)
  return JSON.parse(res.text).name
}

async function refresh($: any) {
  try {
    const team = await load($)
    await update($, view, () => ({ team, error: '' }))
    const list = ranked(team.periods.week)
    const rank = list.findIndex(([id]) => id === team.you) + 1
    $.ui.status(rank ? `Team: you are #${rank} of ${list.length} this week` : 'Team usage')
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
      try {
        const saved = await rename($, m[1] ?? '')
        await refresh($)
        return { text: `Done. Your teammates now see you as "${saved}".` }
      } catch (err: any) {
        return { text: String(err?.message || err) }
      }
    }
    if (args && args !== 'open') {
      return { text: 'Use /team-usage to open the pane, or /team-usage name <your name> to change your name.' }
    }
    await $.ui.open({ id: PANE, title: 'Team usage' })
    void refresh($)
    return { text: 'Team usage pane opened.' }
  })

  // The chip above the prompt: one line, click to expand.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const prev = await next(e)
    const v = await read($, view)
    if (!v.team || e.props.hasSurvey) return prev
    const team = v.team
    const { Box, Button, Text } = $.ui.resolve(e)
    const isOpen = await read($, open)
    const per = (await read($, period)) as 'today' | 'week' | 'month'
    const list = ranked(team.periods[per])
    const mine = list.findIndex(([id]) => id === team.you)
    const me = list[mine]?.[1]
    const top = Math.max(0, ...list.map(([, p]) => p.cost))
    const now = Date.now()

    const label = isOpen
      ? '▾ 🏆 Team usage'
      : `▸ 🏆 ${mine >= 0 ? `#${mine + 1}/${list.length}` : 'Team'}${me ? ` · ${money(me.cost)}` : ''} · ${LABEL[per]}`

    if (!isOpen) {
      return (
        <Box flexDirection="column">
          {prev}
          <Button key="toggle" label={label} onPress={() => update($, open, o => !o)} />
        </Box>
      )
    }

    const width = Math.min(14, Math.max(6, ...list.map(([, p]) => p.name.length)))
    return (
      <Box flexDirection="column">
        {prev}
        <Box>
          <Button key="toggle" label={label} onPress={() => update($, open, o => !o)} />
          <Text dimColor>  {list.length} on the team</Text>
        </Box>
        <Box>
          {(['today', 'week', 'month'] as const).map(k => (
            <Button key={'p' + k} label={(k === per ? '● ' : '○ ') + LABEL[k] + '   '} onPress={() => update($, period, () => k)} />
          ))}
        </Box>
        {list.map(([id, p], i) => {
          const isMe = id === team.you
          const online = p.seen > 0 && now - p.seen < ONLINE_MS
          return (
            <Text bold={isMe}>
              {'  '}{MEDAL[i] || String(i + 1).padStart(2) + ' '}{' '}{p.name.slice(0, width).padEnd(width)}{' '}
              {bar(p.cost, top)} {money(p.cost).padStart(7)} · {short(fresh(p)).padStart(6)}
              {online ? ' ●' : '  '}{isMe ? ' ← you' : ''}
            </Text>
          )
        })}
        <Text dimColor>
          {'  '}● online now · tokens are new tokens (cache excluded){team.nameSet ? '' : ' · set your name: /team-usage name <your name>'}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const v = await read($, view)
    if (!v.team) return <Text dimColor>{v.error || 'Loading team usage…'}</Text>
    const team = v.team
    const section = (label: string, people: Record<string, Person>) => {
      const list = ranked(people)
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>{label}</Text>
          {list.map(([id, p], i) => (
            <Text bold={id === team.you}>
              {i + 1}. {p.name}{id === team.you ? ' (you)' : ''}  {money(p.cost)} · {short(fresh(p))} tokens
            </Text>
          ))}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        <Text dimColor>{'You are ' + team.youName + '. Change it: /team-usage name <your name>'}</Text>
        {section('Today', team.periods.today)}
        {section('Last 7 days', team.periods.week)}
        {section('Last 30 days', team.periods.month)}
        {v.error && <Text dimColor>Last refresh failed: {v.error}</Text>}
      </Box>
    )
  })
}
