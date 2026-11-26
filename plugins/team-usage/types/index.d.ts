export type Bucket = { input: number; output: number; cacheWrite: number; cacheRead: number; messages: number }
export type Member = { handle: string; name: string; seen: number; today: Bucket; week: Bucket; month: Bucket }
export type Team = { you: string; members: Member[] }
export type View = { team: Team | null; error: string }

declare module 'claude-code' {
  interface PluginState {
    'team-usage': { view: Shaped<View>; open: boolean; period: 'today' | 'week' | 'month' }
  }
}
