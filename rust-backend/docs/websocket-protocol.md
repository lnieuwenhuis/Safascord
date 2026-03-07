# Safascord Websocket Compatibility Protocol

Endpoint:
- `GET /ws` upgraded to websocket

Client messages:

```json
{ "type": "subscribe", "channel": "user:<uuid>" }
```

```json
{ "type": "unsubscribe", "channel": "<channel-id-or-name>" }
```

```json
{ "type": "typing.start", "channel": "<channel-id-or-name>", "user": "Display Name", "userId": "<uuid>" }
```

```json
{ "type": "typing.stop", "channel": "<channel-id-or-name>", "user": "Display Name", "userId": "<uuid>" }
```

Server messages:

```json
{ "type": "subscribed", "channel": "<channel>" }
```

```json
{ "type": "unsubscribed", "channel": "<channel>" }
```

```json
{ "type": "typing", "channel": "<channel>", "user": "Display Name", "userId": "<uuid>", "active": true }
```

```json
{
  "type": "message",
  "channel": "<channel>",
  "message": {
    "id": "<uuid>",
    "text": "hello",
    "attachmentUrl": null,
    "ts": "2026-03-07T12:00:00.000Z"
  },
  "user": "Display Name",
  "userAvatar": null,
  "userId": "<uuid>"
}
```

```json
{ "type": "message_delete", "channel": "<channel>", "messageId": "<uuid>" }
```

```json
{
  "type": "message_update",
  "channel": "<channel>",
  "message": {
    "id": "<uuid>",
    "text": "updated",
    "ts": "2026-03-07T12:00:00.000Z"
  }
}
```

```json
{
  "type": "notification",
  "notification": {
    "id": "<uuid>",
    "type": "message",
    "sourceId": "<uuid>",
    "sourceType": "dm",
    "channelId": "<uuid>",
    "channelName": null,
    "serverId": null,
    "channelType": "dm",
    "content": "New message from Example",
    "read": false,
    "ts": "2026-03-07T12:00:00.000Z",
    "quiet": false
  }
}
```

Redis bridge envelope:

```json
{ "channel": "<fanout-channel>", "data": { "type": "message", "...": "..." } }
```

