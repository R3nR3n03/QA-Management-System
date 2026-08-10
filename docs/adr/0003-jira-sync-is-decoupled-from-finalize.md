# Jira sync is decoupled from finalize

Status: proposed

Finalizing a test execution never calls Jira. The finalize transaction commits on QAMS data
alone, and the Jira transition is attempted afterwards as a separate, retryable unit of work
whose outcome is recorded in its own append-only row.

The trigger is not "an execution finalized". It is "every execution carrying this Jira issue
key is Finalized, and all of them derived `Pass`".

Policy for this lives in `../architecture.md#Jira execution sync` and
`../api-and-security.md#Jira execution sync interface`. This record is only the engineering
reasoning; where the two disagree, those documents are right.

## Why

**A network call inside the finalize transaction would be the worst version of this.**
`finalizeExecution` writes the execution, every per-case result, the derived outcome, the
history rows and the audit event in one Prisma transaction. Adding an HTTPS round trip to a
third party inside that boundary holds a database transaction open across someone else's
latency, and makes a Jira outage into a QAMS outage: testers could not record results at all.
QAMS is the system of record for test results. Jira is a downstream projection of them, and a
projection must never be able to block the record.

**Finalized executions are immutable, so there is nothing to retry against.** The obvious
recovery — "re-finalize and it will push again" — does not exist here, and cannot be added
without breaking the immutability rule that the whole execution model rests on. That forces
the sync attempt to be its own record from the start, rather than a status column on the
execution that a retry could update.

**Finalizing one run does not mean the work is done.** A single Jira task routinely has
several executions against it: a browser matrix, a re-run after a fix, a regression pass. The
originally requested rule — finalize an execution, set the issue to Done — moves the ticket to
Done the moment the *first* of those finishes. A board that says "done" while two thirds of
the testing has not run is worse than no integration, because people act on it.

**Status names are text; status categories are not.** Jira has no operation that sets a
status: a transition is executed, and a workflow may legally refuse it. Matching the
transition whose target status is named `Done` breaks on renaming, on localisation, and on
every team that says "Complete" or "Closed". Jira guarantees each status maps to one of three
categories, so resolving by the `done` category works on a workflow nobody configured for us.

## Considered

- **Synchronous push inside the finalize transaction.** Simplest to write and simplest to
  reason about, and rejected outright: it couples a tester's ability to record results to a
  third party's uptime, and holds a transaction open on network I/O.
- **Synchronous push after the transaction commits, still in the request.** Removes the
  transaction problem but not the coupling: a slow Jira makes finalize slow, and a failure
  still has nowhere to be retried from. It also puts the failure in front of the tester, who
  can do nothing about it.
- **Trigger on each execution finalizing, as originally asked.** Rejected on the many-to-one
  case above. Kept as the shipped rule only if a Jira key were unique per execution, which
  would forbid re-runs.
- **Per-user OAuth with no fallback.** The purest attribution story, and the one the QA Lead
  first chose. Rejected as the default because a single expired or revoked token strands an
  issue permanently and silently — the failure mode is invisible drift between two systems
  that people trust. Retained as a configuration option for deployments that prefer a loud
  failure over a bot-attributed write.
- **Service account only.** Operationally simplest and rejected as the default because it
  discards attribution entirely: every transition reads as "QAMS Bot" and the human is
  recoverable only from the QAMS audit log.

## Consequences

- A tester never learns that a Jira push failed. That is deliberate — they cannot fix a token
  or a permission — but it means a terminal failure must surface somewhere a QA Lead actually
  looks, or the two systems drift apart unobserved. A Lead-facing view of failed attempts is
  part of this design, not a later nicety.
- Jira lags QAMS by however long the push takes, including retries. The systems are eventually
  consistent, and a Jira board is never evidence of what QAMS holds.
- QAMS gains its first stored third-party credential. Until now the only secret at rest was a
  password hash. Refresh tokens are a new class of secret with their own encryption,
  revocation and expiry concerns, and a new reason for `api-and-security.md` to exist.
- Some transitions will be attributed to a service account rather than a person. Where that
  happens the QAMS audit event is the only record of who really caused it.
- The transition rule requires knowing every execution that shares an issue key, so the key is
  deliberately non-unique and indexed. Reading one execution is no longer enough to decide
  whether to push.

## Open

**The service-account fallback needs QA Lead ratification.** The QA Lead chose per-user OAuth;
this record makes the fallback the default, which softens that choice by allowing some
transitions to be attributed to a bot. Status stays `proposed` until that is confirmed or the
fallback is turned off by default.
