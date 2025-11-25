export type Selection = {
  serverId?: string
  channelId?: string
  dmId?: string
}

const KEY = "selection"

export function getSelection(): Selection {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function setSelection(sel: Selection) {
  const current = getSelection()
  localStorage.setItem(KEY, JSON.stringify({ ...current, ...sel }))
}

export function clearSelection() {
  localStorage.removeItem(KEY)
}

