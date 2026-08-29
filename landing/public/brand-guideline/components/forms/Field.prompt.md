Label wrapper for every input. The whole thing is a `<label>`, so clicking the text focuses the control.

```jsx
<Field label="Email address"><Input type="email" placeholder="your@email.com" /></Field>
<Field surface="admin" label="Quantity"><Input surface="admin" type="number" defaultValue={10} /></Field>
```
