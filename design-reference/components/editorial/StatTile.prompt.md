# StatTile

Metric card used in dashboard stats, time reports, and admin. Large Newsreader number colored by variant.

```jsx
<StatTile variant="blue" label="DUE TODAY" sanskrit="आज" value={3} sub="2 are high priority" />
<StatTile variant="red" label="OVERDUE" value={1} sub="needs attention" />
```

**Variants:** `blue` (--k-deep), `teal` (--ok), `amber` (--warn), `red` (--danger)
