The admin console button: 8px radius, 10x18 padding, no shadow — flatter and tighter than the owner-facing `Button`.

```jsx
<AdminButton icon={<Icon name="plus" size={16} strokeWidth={2.5} />}>Generate QR batch</AdminButton>
<AdminButton variant="ghost">Refresh</AdminButton>
<AdminButton variant="red">Clear all unprinted</AdminButton>
```

Never use the red brand fill for admin actions — red here means destructive. Tab strips use `primary` for the selected tab and `ghost` for the rest.
