# LiquidFiles API — Integration Reference

**howldr ProofWorks**

This document covers the specific LiquidFiles API calls used by ProofWorks. For full LiquidFiles API documentation see [docs.liquidfiles.com/api](https://docs.liquidfiles.com/api/).

---

## Authentication

All requests use Bearer token authentication with a dedicated ProofWorks service account API key.

```http
Authorization: Bearer {LIQUIDFILES_API_KEY}
Accept: application/json
Content-Type: application/json
```

Retrieve the service account API key:

```http
GET /users/{user_id}/api_key
```

Store the key in your `.env` file as `LIQUIDFILES_API_KEY`. Never commit it to source control.

---

## Folder operations

### Create policy folder hierarchy

At policy initiation, create the top-level policy folder and all subfolders.

```http
POST /shares/folder
```

```json
{
  "share": {
    "name": "POL-2025-001"
  }
}
```

Repeat for each subfolder (`current`, `drafts`, `archive`, `acknowledgements`), using the parent folder ID returned from the previous call.

Store the returned `share.id` as `liquidfiles_folder_id` in `register.json`.

### Move file (promote draft to current)

When a policy is approved, move the approved PDF from `/drafts/` to `/current/`.

```http
POST /shares/folder/move
```

```json
{
  "share": {
    "id": "draft_file_id",
    "folder_id": "current_folder_id"
  }
}
```

---

## File upload

Upload a file attachment before sending a Secure Message.

```http
POST /message/attachments/upload?filename=POL-2025-001-v1.0.pdf
Content-Type: application/pdf

{binary file data}
```

Returns an `attachment.id` to reference when sending the message.

---

## Secure Messages

### Send a secure message

```http
POST /message
```

#### Approval message (non-repudiation required)

```json
{
  "message": {
    "recipients": ["approver@company.com"],
    "subject": "Action required: Approve POL-2025-001 v1.0 — Acceptable Use Policy",
    "message": "Please review and approve the attached policy document. You can approve or return it for revision by replying to this message.\n\nThis message requires authentication to access.",
    "send_email": true,
    "authorization": 3,
    "private": true,
    "expires_at": "2025-04-14",
    "attachments": ["attachment_id_here"]
  }
}
```

#### Acceptance / distribution message (non-repudiation required)

```json
{
  "message": {
    "recipients": ["staff@company.com"],
    "subject": "Please acknowledge: Acceptable Use Policy (POL-2025-001 v1.0)",
    "message": "A new policy requires your acknowledgement. Please read the attached document and reply to confirm you have read, understood, and accept this policy.\n\nThis is a one-time download link — please save or print the document if you need to refer back to it.",
    "send_email": true,
    "authorization": 3,
    "private": true,
    "expires_at": "2025-05-01",
    "expires_after": 1,
    "attachments": ["attachment_id_here"]
  }
}
```

Note: `expires_after: 1` limits each authenticated recipient to a single download.

#### Notification message (non-repudiation not required)

```json
{
  "message": {
    "recipients": ["owner@company.com"],
    "subject": "Policy review due in 30 days: POL-2025-001",
    "message": "Your policy POL-2025-001 (Acceptable Use Policy) is due for review on 2026-03-14. Please initiate the review cycle.",
    "send_email": true,
    "authorization": 0
  }
}
```

### authorization values

| Value | Meaning |
|---|---|
| `0` | No authentication required (link-only access) |
| `1` | Recipient email required |
| `2` | Recipient email + password required |
| `3` | Full LiquidFiles authentication required — Temporary User account issued to external recipients |

Use `3` for all approval and acceptance messages.

---

## Read receipts and download receipts

### Poll for message status

```http
GET /messages/{message_id}
```

Returns per-recipient access log including: `accessed_at`, `ip_address`, `download_count`, `recipient_email`.

### How ProofWorks collects receipts — polling

LiquidFiles v4.3 does not send webhooks, so ProofWorks **polls**: for every
outstanding acceptance it calls `GET /message/{id}/downloads`, on the scheduler
and on demand (`POST /api/policies/:id/receipts/poll`). An authenticated download
is the acknowledgement.

### Webhook (only if your appliance supports it)

ProofWorks also accepts receipt callbacks at:

```
POST https://<your-api-host>/api/webhooks/liquidfiles
```

verified with `LIQUIDFILES_WEBHOOK_SECRET`. Polling still runs either way.

---

## List sent messages

Retrieve sent messages for audit and tracking:

```http
GET /messages/sent
```

Supports pagination. Use the `message_id` stored per notification event in the ProofWorks register to look up individual message receipts.

---

## Temporary User accounts

When a Secure Message with `authorization: 3` is sent to an external recipient (no existing LiquidFiles account), LiquidFiles automatically creates a Temporary User account and emails login credentials to the recipient.

- Default expiry: 7 days (configurable in LiquidFiles admin under Settings → Temporary Users)
- The recipient authenticates with the Temporary User credentials to access the Secure Message
- LiquidFiles records the authentication event against the recipient's email

For external approvers, ensure Temporary User expiry is set to a period longer than your approval deadline.

---

## Error handling

All API calls should be wrapped in try/catch with retry logic for transient failures.

Common error codes:

| Status | Meaning | Action |
|---|---|---|
| `401` | Invalid or expired API key | Check `LIQUIDFILES_API_KEY` in environment |
| `403` | Insufficient permissions | Check service account role in LiquidFiles admin |
| `404` | Resource not found | Verify share ID / message ID |
| `422` | Validation error | Check request payload against API spec |
| `429` | Rate limited | Back off and retry |
| `5xx` | Server error | Retry with exponential backoff; alert on repeated failure |

---

*howldr ProofWorks · [howldr.com](https://howldr.com)*
