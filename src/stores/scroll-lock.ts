import { create } from "zustand"

// GitHub issue #14: the wide CodeBlock/DiffView horizontal ScrollViews live
// inside the chat's vertical (inverted) FlatList. On Android, nestedScrollEnabled
// routes the drag to the child but the parent still scrolls alongside it, so we
// must stop the parent while a horizontal drag is in flight. lock()/unlock()
// flip the parent list's scrollEnabled off and back on.
interface ScrollLock {
  locked: boolean
  lock: () => void
  unlock: () => void
}

export const useScrollLock = create<ScrollLock>((set) => ({
  locked: false,
  lock: () => set({ locked: true }),
  unlock: () => set({ locked: false }),
}))
