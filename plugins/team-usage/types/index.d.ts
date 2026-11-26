export type Person = { cost: number; input: number; output: number; cacheWrite: number; cacheRead: number }
export type Team = {
  you: string
  updated: number
  periods: { today: Record<string, Person>; week: Record<string, Person>; month: Record<string, Person> }
}
export type View = { team: Team | null; error: string }

declare module 'claude-code' {
  interface PluginState {
    'team-usage': { view: Shaped<View>; open: boolean; period: 'today' | 'week' | 'month' }
  }
}
