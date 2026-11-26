import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Person, Team } from '../types'

const PANE = 'team-usage'
const view = atom({ plugin: 'team-usage', key: 'view' } as const, { team: null, error: '' }, {
  shape: 'view-1',
})

const open = atom({ plugin: 'team-usage', key: 'open' } as const, false)
const period = atom({ plugin: 'team-usage', key: 'period' } as const, 'week')
const MEDAL = ['🥇', '🥈', '🥉']
const LABEL = { today: 'Today', week: '7 days', month: '30 days' } as const
const bar = (x: number, max: number) => {
  const n = max > 0 ? Math.max(1, Math.round((x / max) * 8)) : 0
  return '▰'.repeat(n) + '▱'.repeat(8 - n)
}

const short = (x: number) =>
  x >= 1e6 ? (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? (x / 1e3).toFixed(1) + 'K' : String(Math.round(x))
const fresh = (p: Person) => p.input + p.output + p.cacheWrite

async function load($: any): Promise<Team> {
  const home = await $.env.get('HOME')
  let raw = ''
  try {
    raw = await $.fs.read(`${home}/.claude/settings.json`)
  } catch {
    throw new Error('Could not read ~/.claude/settings.json. Run the team setup first.')
  }
  const env = JSON.parse(raw).env || {}
  const endpoint = String(env.OTEL_EXPORTER_OTLP_ENDPOINT || '').replace(/\/+$/, '')
  const auth = String(env.OTEL_EXPORTER_OTLP_HEADERS || '').replace(/^Authorization=/, '')
  if (!endpoint || !auth) throw new Error('Team setup not found in settings.json. Run the setup script first.')
  const res = await $.http.fetch(`${endpoint}/api/usage`, { headers: { Authorization: auth } })
  if (res.status === 401) throw new Error('Your token was not accepted. Ask for a new personal token.')
  if (!res.ok) throw new Error(`Dashboard answered ${res.status}.`)
  return JSON.parse(res.text)
}

async function refresh($: any) {
  try {
    const team = await load($)
    await update($, view, () => ({ team, error: '' }))
    const week = Object.entries(team.periods.week).sort((a: any, b: any) => b[1].cost - a[1].cost)
    const rank = week.findIndex(([n]) => n === team.you) + 1
    $.ui.status(rank ? `Team: you are #${rank} of ${week.length} this week` : 'Team usage')
  } catch (e: any) {
    await update($, view, v => ({ ...v, error: String(e?.message || e) }))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'team-usage', description: "Show everyone's Claude Code usage in a pane" })
    void $.ui.open({ id: PANE, title: 'Team usage' })
    void refresh($)
    $.clock.every(60000, () => void refresh($))
    return next(e)
  })

  on('command.run', { command: 'team-usage' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Team usage' })
    void refresh($)
    return { text: 'Team usage pane opened.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, view)
    const { Box, Button, Text } = $.ui.resolve(e)
    const prev = await next(e)
    if (!v.team || e.props.hasSurvey) return prev
    const team = v.team
    const isOpen = await read($, open)
    const per = (await read($, period)) as 'today' | 'week' | 'month'
    const list = Object.entries(team.periods[per]).sort((a, b) => b[1].cost - a[1].cost)
    const mine = list.findIndex(([n]) => n === team.you)
    const me = list[mine]?.[1] ?? null
    const top = list[0]?.[1].cost || 0

    const pill = (
      <Box>
        <Button key="toggle" label={isOpen ? '▾ 🏆 team usage' : `▸ 🏆 ${mine >= 0 ? '#' + (mine + 1) + ' of ' + list.length : 'team'}${me ? ' · $' + me.cost.toFixed(2) : ''} (${LABEL[per]})`} onPress={() => update($, open, o => !o)} />
      </Box>
    )
    if (!isOpen) return <Box flexDirection="column">{prev}{pill}</Box>

    return (
      <Box flexDirection="column">
        {prev}
        {pill}
        <Box>
          {(['today', 'week', 'month'] as const).map(k => (
            <Button key={'p' + k} label={(k === per ? '● ' : '○ ') + LABEL[k] + '  '} onPress={() => update($, period, () => k)} />
          ))}
        </Box>
        {list.length === 0 && <Text dimColor>  No usage yet.</Text>}
        {list.map(([name, p], i) => (
          <Text bold={name === team.you}>
            {'  '}{MEDAL[i] || '  '} {name.padEnd(10)} {bar(p.cost, top)} ${p.cost.toFixed(2).padStart(6)} · {short(fresh(p))}{name === team.you ? '  ← you' : ''}
          </Text>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const v = await read($, view)
    if (!v.team) return <Text dimColor>{v.error || 'Loading team usage…'}</Text>
    const team = v.team
    const section = (label: string, people: Record<string, Person>) => {
      const list = Object.entries(people).sort((a, b) => b[1].cost - a[1].cost)
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>{label}</Text>
          {list.length === 0 && <Text dimColor>No usage yet.</Text>}
          {list.map(([name, p], i) => (
            <Text bold={name === team.you}>
              {i + 1}. {name}
              {name === team.you ? ' (you)' : ''}  ${p.cost.toFixed(2)} · {short(fresh(p))} tokens
            </Text>
          ))}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {section('Today', team.periods.today)}
        {section('Last 7 days', team.periods.week)}
        {section('Last 30 days', team.periods.month)}
        {v.error && <Text dimColor>Last refresh failed: {v.error}</Text>}
      </Box>
    )
  })
}
