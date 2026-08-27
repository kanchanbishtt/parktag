The reason a stranger is scanning, picked before contact. Two-column grid, one full-width `alert` chip at the end.

```jsx
<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
  <ReasonChip selected>Blocking my car</ReasonChip>
  <ReasonChip>Lights left on</ReasonChip>
  <ReasonChip alert>Accident or emergency</ReasonChip>
</div>
```

Copy stays short and first-person from the scanner's point of view.
