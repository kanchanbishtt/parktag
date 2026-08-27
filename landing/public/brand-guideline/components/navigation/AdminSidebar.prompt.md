The admin console's fixed 240px sidebar: logo + role pill, grouped nav, utilities pinned to the bottom.

```jsx
<AdminSidebar
  active="overview"
  sections={[{ label: "Management", items: [{ id: "overview", label: "Overview", icon: <Icon name="grid" /> }] }]}
  footer={<><AdminButton variant="ghost" full>Refresh</AdminButton><AdminButton variant="red" full>Sign out</AdminButton></>}
/>
```

Keep the real grouping — Management (Overview, E-Tags, Batch Issuance, Print Queue) then Monitoring (Owners, Activity Feed, Admin Management).
