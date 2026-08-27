The 64px navy header on every owner-facing page. Solid #03162D; the logo sits centred with a menu button at the left and a state badge at the right.

```jsx
<AppHeader
  left={<IconButton tone="onDark" label="Menu"><Icon name="menu" size={20} /></IconButton>}
  right={<Badge tone="active" icon={<Icon name="shield" size={13} />}>Active</Badge>}
/>
```

The logo PNG carries `mix-blend-mode: lighten` — keep it, that's how the mark sits cleanly on navy.
