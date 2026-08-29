The E-Tags / owners table. Rows never wrap — the table scrolls horizontally inside its card instead.

```jsx
<DataTable columns={["E-Tag ID", "Vehicle", "Owner", "Status"]} rows={rows} />
```

Put it directly inside an `AdminCard` with no padding overrides.
