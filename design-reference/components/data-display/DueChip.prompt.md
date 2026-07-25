# DueChip
Pill chip for due dates. Auto-calculates relative urgency from ISO date, or use `variant` for manual control.

```jsx
<DueChip date="2026-07-02" />          {/* Tomorrow */}
<DueChip date="Tomorrow" variant="warn" />  {/* Manual */}
<DueChip date="2d overdue" variant="danger" />
```
