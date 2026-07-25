# Hero

Dashboard-only hero section with the "नमस्ते, {Name}." greeting, large Devanagari watermark, date line with Vikram Samvat, a lede, and a 7-day week strip.

```jsx
<Hero
  name="Keval"
  dateLine={[
    { label: 'THURSDAY · गुरुवार' },
    { label: '14 MAY 2026' },
    { label: 'विक्रम संवत् 2083', hindi: true },
  ]}
  lede={<>You have <b>4 open tasks</b>, 1 due today.</>}
  weekDates={weekDates}
  dotsByDay={{ 'Thu May 15 2026': 2 }}
  todayIdx={4}
/>
```
