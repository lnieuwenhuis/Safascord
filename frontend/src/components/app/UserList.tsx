import { useEffect, useState } from "react"
import { api } from "@/lib/api"

export default function UserList({ serverId }: { serverId?: string }) {
  const [groups, setGroups] = useState<{ title: string; users: string[] }[]>([])
  useEffect(() => {
    api.users(serverId).then((r) => {
      const seeded = new Set(["Dylan","Koda","Jayden","Squires","Alex","Flubber","Fraser","Jack","Sam"])
      const actual = r.groups
        .map((g) => ({ title: g.title, users: g.users.filter((u) => !seeded.has(u)) }))
        .filter((g) => g.users.length > 0)
      const seededUsers = Array.from(new Set(r.groups.flatMap((g) => g.users.filter((u) => seeded.has(u)))))
      const final = actual.length > 0 ? actual : (seededUsers.length > 0 ? [{ title: "Seeded", users: seededUsers }] : [])
      setGroups(final)
    }).catch(() => setGroups([]))
  }, [serverId])
  return (
    <aside className="h-dvh w-full overflow-y-auto border-l border-white/10 bg-[#0f1524] p-3">
      <div className="space-y-6">
        {groups.map((g, idx) => (
          <div key={idx}>
            <div className="text-xs uppercase text-muted-foreground">{g.title}</div>
            <ul className="mt-2 space-y-1">
              {g.users.map((u) => (
                <li key={u} className="flex items-center justify-between rounded px-2 py-1 hover:bg-white/5">
                  <div className="flex items-center gap-2">
                    <span className="h-6 w-6 rounded-full bg-blue-500" />
                    <span className="text-sm">{u}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">Online</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </aside>
  )
}
