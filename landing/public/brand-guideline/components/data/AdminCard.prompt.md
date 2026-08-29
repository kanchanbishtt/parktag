The admin console's only content container: 14px radius, 1px grey border, a single 1px shadow.

```jsx
<AdminCard title="Current queue" badge={<Badge tone="gray">128</Badge>} sub="Unclaimed tags ready for the printing vendor."
  actions={<><AdminButton>Export QRs</AdminButton><AdminButton variant="ghost">Refresh</AdminButton></>}>
  {rows}
</AdminCard>
```

Cards stack with a 12px gap; don't nest them.
