# Tag reports: from the scan page to the admin panel

Added 2026-10-06. Until then a report was written to MongoDB and nothing ever
read it back: no page, no count, no notification.

## Where a report comes from

The scan page's "Report wrong info" action opens `/report-tag?tag=<token>`.
The form posts to `POST /api/tags/:token/report` (`routes/public/index.js`):
a reason (`sold`, `wrong_number`, `no_answer`, `abuse`, `other`), optional
free text up to 1,000 characters, the reporter's name and a valid Indian
mobile, and a reCAPTCHA v2 token. Rate-limited to 5 per 10 minutes per IP.
One document lands in `tag_reports` with `status: "open"`, the tag's id and
token, the owner's id, a hashed reporter IP and `createdAt`.

The owner is never told. A report is an accusation; it goes to us.

## Where it is read

- **Admin page** `/admin/tag-reports` (sidebar: Monitoring → Tag Reports).
  Open first, then Resolved and All, with counts. Each row: the reason and
  free text, the reported sticker as it is now (plate linked to the Tags page,
  serial, state) and its owner with a call link, the reporter with call and
  WhatsApp links, and a "Mark resolved" button with an optional note.
  Resolving records `resolvedAt`, `resolvedBy` (the admin's email) and the
  note; Reopen clears the resolution but keeps the note. Nothing is deleted.
- **Overview** "Open tag reports" tile under Needs attention
  (`summary.reports.open`).
- **API** `GET /api/admin/tag-reports?status=&q=&page=` (read scope) and
  `POST /api/admin/tag-reports/:id/status` (ops scope).
- **MCP** `parktag_tag_reports` (read; customer text fenced as untrusted) and
  `parktag_resolve_tag_report` (ops).

Search covers the reporter's name and number, the free text, and the reported
plate or serial (matched through the tag).

## Privacy

The reporter's number exists so support can call them back. It is shown on the
admin page and in the admin API only, never on a scan page and never to the
owner. The admin page's own copy says so.

## Not done

- No notification when a report arrives (no email, WhatsApp or Slack). The
  overview tile is the only prompt. A daily digest line would be the natural
  next step if reports start coming in.
- No action is taken on the tag from the report row (pause, deactivate). The
  plate links to the Tags page, where those actions already exist.
