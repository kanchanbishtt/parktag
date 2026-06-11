# WhatsApp MVP Plan

This note captures the current Phase 1 direction for owner-message delivery.

## Decision

For the MVP, WaveTag will implement:

- `WhatsApp` recovery messaging

It will not implement:

- `SMS`

This keeps the messaging slice aligned with the available business account and reduces split-provider complexity.

## Official Product Direction

Use the official Meta WhatsApp Business Platform Cloud API as the primary reference.

The implementation plan assumes:

- backend sends WhatsApp messages server-side through the Cloud API
- backend receives delivery-status updates through a webhook
- secrets stay server-side only
- scanner-side UI never sees access tokens, phone number IDs, or webhook verification values

## Required Setup Inputs

The MVP messaging slice should not start until these values are available:

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `WHATSAPP_GRAPH_API_VERSION`

Optional but likely needed depending on template usage:

- approved message template name
- approved template language code

## MVP Flow

1. Scanner enters a phone number.
2. Scanner chooses the message path.
3. Scanner writes or accepts the default message body.
4. Backend creates a message-attempt record.
5. Backend sends the WhatsApp message through the Cloud API.
6. Backend stores the immediate API response.
7. WhatsApp webhook callbacks update delivery state.
8. Owner and admin surfaces show message state safely.

## Backend Surfaces Needed

- message-request creation route
- WhatsApp send service
- webhook verification route
- webhook receive route
- owner dashboard message-attempt visibility
- admin dashboard message-attempt visibility

## Verification Plan

The slice is only complete when all of these are proven:

1. local/dev environment can create a WhatsApp message-attempt without touching production collections
2. deployed webhook verification succeeds
3. scanner `Send Message` triggers a real WhatsApp send attempt
4. owner and admin surfaces show the message-attempt state
5. delivery or failure callbacks update stored status
6. failure states stay privacy-safe

## Current Non-Goal

This note does not change the current call path decision. It only narrows the message-recovery path to WhatsApp for the MVP.
