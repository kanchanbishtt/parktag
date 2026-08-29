The owner's 280px left slide-out: identity block at the top, a short item list, no footer.

```jsx
<MenuDrawer open={open} name="Rohit Sharma" email="rohit@example.com" onClose={close}>
  <MenuItem active icon={<Icon name="grid" size={18} />}>Dashboard</MenuItem>
  <MenuItem tone="danger" icon={<Icon name="logout" size={18} />}>Sign out</MenuItem>
</MenuDrawer>
```

Keep it short — the owner surface is deliberately two or three destinations.
