export interface Message {
  id: string
  user: string
  userAvatar?: string
  userId?: string
  text: string
  attachmentUrl?: string
  ts: string
  roleColor?: string
}
