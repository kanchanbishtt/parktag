A switch that comes with its consequence written next to it — used for batch-level settings like premium access. The whole row tints red when on.

```jsx
<ToggleRow
  title="Premium access"
  description="Owners who claim this batch get unlimited contact (no free-call limit)"
  checked={premium}
  onChange={(e) => setPremium(e.target.checked)}
/>
```

Only use it where the state changes what a batch or account can do; plain yes/no answers stay `Checkbox`.
