const dms = Array.from({ length: 15 }).map((_, i) => ({ id: i, name: `User ${i + 1}` }))

import UserCard from "./UserCard"
import { useNavigate } from "react-router-dom"

export default function DMListSidebar() {
  const navigate = useNavigate()
  return (
    <aside className="flex h-dvh w-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="px-3 py-3">
        <div className="mb-3 px-2 text-sm font-semibold">Direct Messages</div>
        <ul className="max-h-full space-y-1">
          {dms.map((dm) => (
            <li
              key={dm.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              onClick={() => navigate(`/channels/@me/${dm.id}`)}
            >
              <span className="h-6 w-6 rounded-full bg-primary" />
              <span className="text-sm">{dm.name}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-auto">
        <UserCard />
      </div>
    </aside>
  )
}
