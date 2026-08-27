Owner- and scanner-facing button; the red `primary` and near-black `activate` variants carry almost every screen.

```jsx
<Button variant="activate" full icon={<Icon name="login" size={18} />}>Open dashboard</Button>
<Button variant="whatsapp" sub="Reply comes to your WhatsApp">Message on WhatsApp</Button>
```

Rules: one red button per view; `whatsapp`/`call` are reserved for the two real contact channels; press feedback is a scale-down, never a colour change. Admin console screens use `AdminButton` instead.
