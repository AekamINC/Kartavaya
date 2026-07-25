# SegmentedControl
Pill-shaped segmented radio used for filter bars (Mine / All / Overdue / Done). Active tab shows accent-tinted count badge.

```jsx
<SegmentedControl
  options={[
    { id: 'mine', label: 'Mine', count: 4 },
    { id: 'all', label: 'All open', count: 11 },
    { id: 'done', label: 'Done', count: 2 },
  ]}
  active="mine"
  onChange={setTab}
/>
```
