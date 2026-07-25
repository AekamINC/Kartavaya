# PageHeader

Every non-dashboard page starts with this header. Kicker is uppercase teal text, title is Newsreader serif, Sanskrit label is in `--k-primary`, lede is a brief description.

```jsx
<PageHeader
  kicker="WORKSPACE"
  title="Tasks"
  sanskrit="कर्तव्य"
  lede="The list of what's worth doing today."
  right={<Button variant="primary">+ New task</Button>}
/>
```
