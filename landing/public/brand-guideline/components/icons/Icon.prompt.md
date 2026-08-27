The single icon primitive: 24x24 stroke-2 glyphs lifted verbatim from the ParkTag pages — use it anywhere the product shows an icon.

```jsx
<Icon name="printer" size={16} />
<span style={{ color: "var(--accent)" }}><Icon name="check" size={18} /></span>
```

Colour comes from `currentColor`, so set `color` on the parent. Names outside `PT_ICONS` are not part of the brand — ask before adding one, and copy the path from the codebase rather than drawing it.
