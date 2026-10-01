# Privacy

> Status: principles binding now; profile and visibility features ship in Phase 8, and export
> and deletion in Phases 2 and 13.

## Principles

1. Users decide exactly what others can see, per field, not with one public/private switch.
2. Public views are **assembled server-side** from explicitly permitted fields. The complete
   profile object is never sent to a client to be filtered in the UI.
3. Sensitive data defaults to **private**.
4. Blocking overrides discovery and interaction everywhere: search, leaderboards, profiles,
   friend requests and suggestions.
5. AI context, memories, chat history and proposals are owner-only and never appear on profiles.
6. PlanIT never stores BYOK keys and never uses AI conversations as analytics data.

## Visibility model

`ProfileVisibility.profileVisibility` ∈ {PRIVATE, FRIENDS, PUBLIC} caps every field.
`ProfileFieldVisibility(field)` ∈ {PRIVATE, FRIENDS, PUBLIC} sets each field. A field is visible
to a viewer when:

```
viewer is owner
OR ( not blocked in either direction
     AND min(profileVisibility, fieldVisibility) permits the viewer's class )
where viewer classes: PUBLIC (anyone, including anonymous) < FRIENDS (accepted friend)
```

Blocked viewers get `404` for the profile, exactly as if it did not exist.

### Fields and defaults

| Group        | Field                                                                                                | Default                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Identity     | `USERNAME`, `AVATAR`, `DISPLAY_NAME`                                                                 | PUBLIC (needed to find and add friends; can be lowered) |
| Identity     | `BIO`                                                                                                | FRIENDS                                                 |
| Identity     | `BIRTHDAY`, `COUNTRY`                                                                                | PRIVATE                                                 |
| Productivity | `TOTAL_FOCUS`, `STREAK`                                                                              | FRIENDS                                                 |
| Productivity | `DAILY_STATS`, `WEEKLY_STATS`, `MONTHLY_STATS`, `PERSONAL_RECORDS`, `MOST_PRODUCTIVE_DAY/WEEK/MONTH` | PRIVATE                                                 |
| Skills       | `SKILLS`                                                                                             | FRIENDS                                                 |
| Skills       | `SKILL_TIME`                                                                                         | PRIVATE                                                 |
| Goals        | `GOALS`, `GOAL_PROGRESS`                                                                             | PRIVATE                                                 |
| Leaderboard  | `FRIENDS_LEADERBOARD`                                                                                | FRIENDS                                                 |
| Leaderboard  | `GLOBAL_LEADERBOARD`, `RANK`                                                                         | PRIVATE (global ranking is opt-in; see decision D-019)  |

Overall `profileVisibility` defaults to FRIENDS. `discoverable` (appear in user search) defaults
to true and can be turned off. Showing recent profile viewers defaults to off.

### Preview

"Preview My Profile" calls `GET /api/v1/profiles/me/preview?as=public|friend`. It runs the same
assembler as real viewers, so the preview is exactly what others see.

## Data inventory (current and planned)

| Data                               | Purpose                        | Visibility                                | Retention                                                           |
| ---------------------------------- | ------------------------------ | ----------------------------------------- | ------------------------------------------------------------------- |
| Account (email, password hash)     | authentication                 | owner only                                | until account deletion                                              |
| Profile fields                     | social features                | per visibility model                      | until changed/deleted                                               |
| Tasks, goals, skills, availability | planning                       | owner only                                | until deleted                                                       |
| Focus sessions, aggregates         | statistics                     | owner; selected aggregates per visibility | until deleted                                                       |
| AI chat history, memories          | assistant continuity           | owner only                                | user-deletable; default retention 12 months for chat (configurable) |
| AI proposals                       | confirmation and audit         | owner only                                | 90 days after resolution                                            |
| AI usage records                   | quotas (managed) / info (BYOK) | owner only                                | 13 months                                                           |
| Audit log                          | security                       | internal                                  | 1 year                                                              |
| OTP records                        | verification                   | internal                                  | deleted after expiry plus 24 hours                                  |
| Logs                               | operations                     | internal                                  | 30 days; never contain secrets or content                           |

## User rights (planned)

- **Export:** full data export (JSON) and PlanIT context export (Markdown, JSON, plain text;
  Phase 13). Never includes passwords, password hashes, tokens, API keys or infrastructure
  secrets.
- **Delete:** account deletion with a short grace period (`status = PENDING_DELETION`, sessions
  revoked immediately), then hard deletion of all owned rows by cascade. Profile fields, AI
  memories and chat history are individually deletable at any time.
- **Sessions:** list and revoke active sessions.
- **BYOK:** "Remove key" clears it from memory immediately. Nothing exists server-side to delete.

## Analytics policy

Product analytics, if added, record only safe metadata: page and feature usage counts, AI request
counts, provider, model, latency, token counts and outcome. Never prompt or response content,
task text, credentials or BYOK material. Third-party analytics scripts require a privacy review
and a CSP change.
