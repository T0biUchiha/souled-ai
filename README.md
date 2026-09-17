# Clinical Note Review

A React and TypeScript foundation for a clinical-note review workflow. The initial application intentionally contains only an application shell; workflow screens come after the domain contract is agreed.

## Run locally

```sh
npm install
npm run dev
```

Useful checks:

```sh
npm run build
npm run typecheck
npm run lint
npm test
```

## Architecture

```text
src/
├── app/                    # Application composition: providers, router, shell
├── auth/                   # Small client-only session state
├── data/                   # API adapters and persistent offline storage
├── domain/                 # Framework-independent model and workflow policy
│   ├── types.ts            # Note, NoteVersion, ReviewEvent, SOAP, identities
│   ├── state-machine.ts    # Central lifecycle transitions, guards, effects
│   ├── permissions.ts      # UX-only capability helpers
│   ├── selectors.ts        # UI-ready action/read-only derivation
│   ├── version-graph.ts    # Immutable version relationship validation
│   └── result.ts           # Explicit domain operation results/errors
├── features/               # Screen-specific UI and orchestration, by feature
├── shared/                 # Reusable presentational components and utilities
├── telemetry/              # Telemetry contracts and adapters
└── test/                   # Shared test setup
```

`domain/` does not import React, data libraries, or browser APIs. It models a `Note` as a workflow container, immutable `NoteVersion` snapshots as a graph through `parentVersionId`, and append-only `ReviewEvent` audit records.

The lifecycle machine and a Mermaid diagram are documented in [src/domain/STATE_MACHINE.md](src/domain/STATE_MACHINE.md).

### State ownership

| State | Home | Reason |
| --- | --- | --- |
| Server state | TanStack Query hooks in `features/<feature>/` backed by `data/` API clients | Caching, invalidation, loading, and retries belong with remote resources. |
| URL state | React Router routes and search parameters in `app/` / relevant feature | Navigable, shareable screen and filter state. |
| Local editor state | Feature-local React state or reducer | Draft interactions are scoped to an active editing surface. |
| Persistent offline state | Dexie tables in `data/offline-db.ts` | Offline copies and queued work survive reloads without becoming global UI state. |
| Client-only session/UI state | Small Zustand stores in `auth/` or feature-local stores | Ephemeral state only; never a cache for server entities. |
| Domain logic | Pure modules in `domain/` | It can be tested independently and reused by data or UI orchestration. |

## Assumptions

- Authentication and authorization are ultimately enforced by the server. The frontend workflow policy is a UX guard and a testable representation of expected behavior.
- A clinician or admin can retry a failed generation; approval/rejection requires an active review; only admins can lock or unlock.
- Creating an amendment produces a new immutable version in a later data-layer command. Sibling versions are permitted, so `parentVersionId` deliberately represents a graph, not a mutable linear history.
- Event IDs, timestamps, and final audit persistence are server-generated in production. The browser never modifies an existing `ReviewEvent`.
- Playwright is intentionally deferred to the requested E2E phase.
