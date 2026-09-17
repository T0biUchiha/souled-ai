# Note lifecycle state machine

`evaluateTransition(context, action)` is the only client-side source for lifecycle decisions. It is pure: the caller applies its returned effects only after the server accepts the command.

```mermaid
stateDiagram-v2
  GENERATING --> READY_FOR_REVIEW: generation.complete (server)
  GENERATING --> FAILED: generation.error (server)
  FAILED --> GENERATING: regenerate
  READY_FOR_REVIEW --> IN_REVIEW: start_review
  IN_REVIEW --> READY_FOR_REVIEW: return
  IN_REVIEW --> APPROVED: approve + MFA
  IN_REVIEW --> REJECTED: reject + reason
  REJECTED --> READY_FOR_REVIEW: resubmit / new version
  APPROVED --> AMENDED: amend / branch version (<24h)
  APPROVED --> LOCKED: grace_expired (scheduler)
  AMENDED --> IN_REVIEW: start_review
```

The centralized `transitionSpecifications` map owns sources, allowed predecessor states, roles, guards, target state, and declarative effects. The data layer should use the same action and context when submitting server commands; a server decision always remains authoritative.

Approval requires `mfaReauthenticated: true`. On success, the explicit `RECORD_MFA_REAUTHENTICATION` effect is returned for audit persistence; otherwise the machine returns `MFA_REAUTH_REQUIRED` without changing state.
