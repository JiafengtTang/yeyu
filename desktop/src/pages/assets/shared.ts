import type { UserDTO } from '@yeyu/shared'
import { api } from '../../api/client'

export interface OwnerOption {
  id: string
  name: string
}

export type BadgeTone = 'default' | 'success' | 'warning' | 'danger' | 'info'

export function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'IN_USE':
      return 'success'
    case 'IDLE':
      return 'info'
    case 'BORROWED':
      return 'warning'
    case 'REPAIR':
      return 'warning'
    case 'SCRAPPED':
      return 'danger'
    default:
      return 'default'
  }
}

export function mergeOwners(primary: OwnerOption[], extra: OwnerOption[]): OwnerOption[] {
  const seen = new Set<string>()
  const merged: OwnerOption[] = []
  for (const owner of [...primary, ...extra]) {
    if (seen.has(owner.id)) continue
    seen.add(owner.id)
    merged.push(owner)
  }
  return merged
}

export interface GroupOption {
  id: string
  name: string
}

export async function fetchGroups(): Promise<GroupOption[]> {
  try {
    const result = await api<{ items: Array<{ id: string; name: string }> }>('/api/groups')
    return result.items.map((group) => ({ id: group.id, name: group.name }))
  } catch {
    return []
  }
}

export async function fetchOwners(): Promise<OwnerOption[]> {
  try {
    const result = await api<{ items: UserDTO[] }>('/api/users', { query: { pageSize: 200 } })
    return result.items.map((user) => ({ id: user.id, name: user.name }))
  } catch {
    return []
  }
}

export function canEditAsset(
  asset: { ownerId: string | null },
  user: { id: string } | null,
  isAdmin: boolean
): boolean {
  if (isAdmin) return true
  return Boolean(user && asset.ownerId && asset.ownerId === user.id)
}
