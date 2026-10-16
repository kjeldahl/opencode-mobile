import { create } from "zustand"
import * as SecureStore from "expo-secure-store"
import { type Category, defaultPreferences } from "../lib/notifications"
import { clampPageSize, mergeStoredSettings } from "../lib/settings-merge"
import { setAppLocale } from "../lib/i18n/config"
import type { LocalePreference } from "../lib/i18n/locale-resolve"

const SETTINGS_KEY = "opencode_settings"

interface Settings {
  pageSize: number
  notifications: Record<Category, boolean>
  locale: LocalePreference
  aiSummaries: boolean
  aiSummariesAlways: boolean
}

const DEFAULTS: Settings = {
  pageSize: 25,
  notifications: { ...defaultPreferences },
  locale: "system",
  aiSummaries: false,
  aiSummariesAlways: false,
}

interface SettingsState extends Settings {
  loaded: boolean
  load: () => Promise<void>
  setPageSize: (size: number) => Promise<void>
  setNotification: (category: Category, enabled: boolean) => Promise<void>
  setLocale: (locale: LocalePreference) => Promise<void>
  setAiSummaries: (enabled: boolean) => Promise<void>
  setAiSummariesAlways: (enabled: boolean) => Promise<void>
}

function snapshot(get: () => SettingsState): Settings {
  return {
    pageSize: get().pageSize,
    notifications: get().notifications,
    locale: get().locale,
    aiSummaries: get().aiSummaries,
    aiSummariesAlways: get().aiSummariesAlways,
  }
}

async function persist(settings: Settings) {
  await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(settings))
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  loaded: false,

  load: async () => {
    const raw = await SecureStore.getItemAsync(SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>
      // Merge stored settings with defaults so new fields/categories get their default
      const merged = mergeStoredSettings(DEFAULTS, parsed)
      set({ ...merged, loaded: true })
      setAppLocale(merged.locale)
      return
    }
    set({ loaded: true })
  },

  setPageSize: async (size) => {
    const clamped = clampPageSize(size)
    set({ pageSize: clamped })
    await persist({ ...snapshot(get), pageSize: clamped })
  },

  setNotification: async (category, enabled) => {
    const notifications = { ...get().notifications, [category]: enabled }
    set({ notifications })
    await persist({ ...snapshot(get), notifications })
  },

  setLocale: async (locale) => {
    set({ locale })
    setAppLocale(locale) // applies immediately
    await persist({ ...snapshot(get), locale })
  },

  setAiSummaries: async (aiSummaries) => {
    set({ aiSummaries })
    await persist({ ...snapshot(get), aiSummaries })
  },

  setAiSummariesAlways: async (aiSummariesAlways) => {
    set({ aiSummariesAlways })
    await persist({ ...snapshot(get), aiSummariesAlways })
  },
}))
