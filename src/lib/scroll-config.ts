// Pure (no React Native imports) horizontal-scroll configuration shared by
// src/components/chat/DiffView.tsx and src/components/markdown/CodeBlock.tsx.
//
// GitHub issue #21: wide diff lines and wide code-block lines must render in
// a horizontally-scrollable container instead of being wrap-broken or
// truncated with `numberOfLines`. Centralizing the actual runtime props in
// one plain object lets that decision be unit-tested with node:test (no React
// Native renderer needed) while both components spread the SAME object onto
// their ScrollView, so the test and the real components can't drift apart.
export interface HorizontalScrollConfig {
  horizontal: true
  showsHorizontalScrollIndicator: boolean
  // GitHub issue #14: these ScrollViews live inside a vertical FlatList. Without
  // nestedScrollEnabled the parent steals the touch on Android and scrolls
  // vertically instead of letting the wide content scroll horizontally.
  nestedScrollEnabled: boolean
}

export const WIDE_CONTENT_SCROLL_CONFIG: HorizontalScrollConfig = {
  horizontal: true,
  showsHorizontalScrollIndicator: true,
  nestedScrollEnabled: true,
}
