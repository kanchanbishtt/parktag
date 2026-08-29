The text input. Focus is always the red border (plus a soft ring on scanner surfaces) — never a blue browser outline.

```jsx
<Input placeholder="your@email.com" />
<Input surface="scanner" format="plate" placeholder="DL 8C AB 1234" />
<Input surface="admin" placeholder="BATCH-001" />
```

Vehicle numbers always use `format="plate"`; OTP / tag codes use `format="code"`.
