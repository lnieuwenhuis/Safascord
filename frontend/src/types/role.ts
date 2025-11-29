export interface Role {
  id: string
  name: string
  color: string
  position: number
  canManageChannels: boolean
  canManageServer: boolean
  canManageRoles: boolean
}
