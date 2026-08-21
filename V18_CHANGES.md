# Family v18

## What changed
- Fixed WebSocket reconnect state so `API.ws` always points to the live socket.
- Added active-chat signaling to the server. Push notifications are suppressed when the recipient is currently viewing that exact chat.
- Fixed Service Worker response cloning (`Response body is already used`).
- Added favicon and the modern `mobile-web-app-capable` meta tag.
- Chat opening is lighter: user list and messages load in parallel; audio hydration is deferred to the DOM.
- Sent text/media/voice messages are appended to the open chat without rebuilding the chat, preserving scroll and typed text.
- Incoming messages no longer trigger an in-app notification/toast when the user is already inside that exact chat.
- Fixed private media-only messages on the server (`hasMedia` is now included in the empty-message check).
- Added photo/video sending to group chats.
- Added circular voice-message playback controls.
- Improved WebRTC signaling: queued ICE candidates on the receiving side, pending call offers when a recipient temporarily has no WebSocket, call push notification fallback, and less aggressive disconnect handling.
- Incoming call UI is global and does not depend on the current chat screen.
- Added user-created group chats. Any family member can create a group and choose members.
- Added a membership flag for the legacy `Семья` chat. Existing users are retained; newly created users are NOT automatically added to that chat.
- Added group unread counts, read markers, messages, media, voice, and reactions.

## Deployment safety
- Do NOT upload or overwrite `server/data/family.json` from this package.
- Keep the Railway Persistent Volume mounted at `/app/data`.
- Deploy code files only.
- Recommended first deploy: replace `server/server.js`, then the client files.
- After deployment, verify the users in `/app/data/family.json` before doing further changes.
