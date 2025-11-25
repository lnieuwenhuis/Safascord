const groups = [
  { title: "Admin", users: ["Dylan", "Koda"] },
  { title: "Staff", users: ["Jayden", "Squires"] },
  { title: "FST", users: ["Alex", "Flubber", "Fraser", "Jack", "Sam"] },
]

export default function UserList() {
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
