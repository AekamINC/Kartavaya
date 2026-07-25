# KanbanCard
Card for the Kanban board. Shows priority dot + ID, title (1-3 lines, ellipsis), footer with due chip, comment/attachment counts, and avatar stack.

```jsx
<KanbanCard
  id="KAR-184"
  title="Compile Q1 GSTR-3B working notes"
  priority="high"
  assignees={[{ name: 'Keval Shah' }, { name: 'Aanya Mehta' }]}
  comments={4}
  attachments={2}
  due={<DueChip date="Tomorrow" variant="warn" />}
/>
```
