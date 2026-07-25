# MemberCard
Team grid card: avatar + name + role badge, stats row (open/done/avg cycle), and up to 3 recent tasks with priority dots.

```jsx
<MemberCard
  name="Keval Shah" role="admin" tz="IST"
  openTasks={4} doneThisWeek={0} avgCycle="13H"
  recentTasks={[
    { title: 'Compile Q1 GSTR-3B...', id: 'KAR-184', priority: 'high' },
  ]}
/>
```
