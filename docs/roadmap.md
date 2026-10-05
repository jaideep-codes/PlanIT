# Roadmap

Each phase ends runnable, typed, linted and tested, with documentation updated, and then
**stops** for review. See the per-phase workflow in `docs/development.md`.

| Phase | Scope                                                                                                                                                                                                        | Status        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| 0     | Architecture, repository bootstrap, documentation, conventions                                                                                                                                               | ✅ Done       |
| 1     | Foundation: TypeScript, Postgres + Prisma, Redis, Docker, env config, logging, errors, health checks, frontend shell, theme system, base UI                                                                  | ✅ Done       |
| 2     | Auth: signup, email/password, mandatory email OTP, login/logout, Google login, password reset, sessions (rotating refresh tokens), route protection, audit log, BullMQ + email queue, Playwright E2E harness | ✅ Done       |
| 3     | Tasks: one-off CRUD, priority, notes, due dates, scheduling, estimates, sort/filter, manual order, completion. Recurrence and the Home task UI have not started                                              | In progress   |
| 4     | Focus engine: start/pause/resume/stop, server-authoritative timing, active-session recovery, history, task association                                                                                       | Planned       |
| 5     | Dashboard + internal calendar: progress, priority progress, focus today, active timer, day/week views, focus history; in-app notifications basics; PWA service worker                                        | Planned       |
| 6     | Statistics: daily/weekly/monthly/all-time, heatmap, records, streaks, aggregation jobs, analytics cache                                                                                                      | Planned       |
| 7     | Goals + skills: goals, milestones, task links, target focus time, progress, skills, skill time                                                                                                               | Planned       |
| 8     | Social: profiles, avatars, field-level privacy, preview, friends, requests, blocking, profile views, leaderboards (friends/global × daily/weekly/monthly × focus/streak/tasks)                               | Planned       |
| 9     | PlanIT AI core: chat, provider abstraction, managed AI, context assembly, structured outputs, proposals (validation, expiry, idempotent exact-approval execution), task application                          | Planned       |
| 10    | AI scheduling + re-planning: availability, planning preferences, daily planner, missed-task detection, re-plan, calendar confirmation, weekly insights                                                       | Planned       |
| 11    | BYOK: OpenAI/Gemini/Anthropic direct-from-browser, ephemeral in-memory key, context-scope controls, usage display, Trusted Types enforcement                                                                 | Planned       |
| 12    | PlanIT AI usage: limits, token tracking, reset periods, warnings, entitlement integration, usage dashboard                                                                                                   | Planned       |
| 13    | Context export: Markdown, JSON, plain text                                                                                                                                                                   | Planned       |
| 14    | MCP server (**only when explicitly instructed**)                                                                                                                                                             | Not scheduled |
| 15+   | External integrations (**only when explicitly instructed**): Google Calendar, GitHub, LinkedIn, Notion, Spotify, WhatsApp                                                                                    | Not scheduled |

## Phase 2 (done)

Part 1: signup, email OTP verification, login, logout, rotating refresh sessions, the session
guard, audit events for those actions, and the email queue. Part 2: password reset, the current
user, theme persistence, and session list/revoke. Part 3: Google sign-in. Part 4: the Playwright
browser harness, CI (browser tests and the secret scan), and the Phase 2 security pass.

## Phase 3 (in progress)

Part 1 is the one-off task API: create, read, update, delete, complete, reopen, manual position,
filter, and sort. Parts 2, 3, and 4 have not started. Recurrence and the Home task UI are not part
of Part 1. Focus, the calendar, and the dashboard remain later phases.

## Deliberately deferred (not to be built without explicit instruction)

Google Calendar / external calendar sync, GitHub, LinkedIn, Notion, Spotify, WhatsApp (chatbot
and notifications), native mobile apps, generic social feed (posts, likes, comments, shares,
reposts, followers), reels, mentor marketplace, consultations, video calls, payments and
payouts, OAuth providers other than Google sign-in, configurable AI trust levels.

## Later ideas (productivity-specific social)

Achievement sharing, challenges, productivity circles, LinkedIn-style content generation
(generation only, no publishing integration), monthly productivity reports.
