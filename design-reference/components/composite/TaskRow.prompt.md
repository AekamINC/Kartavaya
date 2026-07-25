# TaskRow
Grid-based task row for the Tasks list view. Columns: priority dot + ID + title, project tag, avatar stack, priority label, due chip.

```jsx
<TaskRow
  id="KAR-104"
  title="Compile Q1 GSTR-3B working notes"
  project={{ name: 'Quarterly GST filing', color: '#0082c6' }}
  priority="high"
  assignees={[{ name: 'Keval Shah' }]}
  due={<DueChip date="Tomorrow" variant="warn" />}
/>
```
