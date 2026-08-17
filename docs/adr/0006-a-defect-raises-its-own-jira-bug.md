# A defect raises its own Jira bug, and a label makes that retryable

Status: accepted

Raising a defect in QAMS creates a bug in Jira, stores the issue key on the defect, comments
on it at every lifecycle transition, and transitions it to Done when the defect closes.

Every issue QAMS raises is **labelled with the defect's business ID**, and a create searches
for that label before it creates anything.

Policy lives in `../architecture.md#Jira defect sync`; this record is only the engineering
reasoning, and where the two disagree that document is right.

## What is different about this one

The execution sync ([ADR-0003](0003-jira-sync-is-decoupled-from-finalize.md),
[ADR-0004](0004-result-comments-are-posted-on-every-finalize.md)) only ever touches issues a
person already made: it moves one, or adds a comment to one. Both are **idempotent enough** to
retry carelessly. Transitioning an issue that is already Done is a no-op in Jira's own terms,
and a duplicate comment is noise.

Creating is neither. A create that succeeds in Jira and fails to be recorded in QAMS — a lost
response, a process killed between Jira's answer and the write that stores the key — leaves an
issue nobody in QAMS knows about. Retry it and there are two bugs for one defect. Duplicate
bugs in a shared project are tedious to clean up and impossible to clean up invisibly, and the
people cleaning them up are not the people who run QAMS.

So the choice was between *not retrying creates at all* and *making creation recognisable*.

Not retrying was rejected because the failure it leaves behind is the worst one in the
feature: a defect that never reached Jira is invisible to every developer working from the
board, and nothing about the QAMS record hints that anything is missing. That is precisely the
case that most needs a retry.

## The label

The issue carries `qams-<defect business ID>`, for example `qams-BUG-0001`. Before creating,
the transport searches the target project for that label. Finding one **adopts** it — QAMS
stores the key and records the attempt as an adoption rather than a creation — and finding
none proceeds to create.

Three consequences worth stating:

- **The search is paid on every create, not only on retries.** A retry cannot tell it is a
  retry; that is the whole problem. The cost is one search per raised defect.
- **A failed search does not fall through to creating.** Searching is how this call knows
  whether it is about to duplicate something, so proceeding without an answer would defeat the
  purpose entirely. It fails and is retried, which is the safe direction: a late bug is
  recoverable, a duplicate one is somebody else's cleanup.
- **The label is safe in JQL by construction.** It is derived from a business ID that
  `BUSINESS_ID_PATTERNS` restricts to letters, digits and hyphens, so nothing in one can escape
  the quotes around it.

`Defect.jiraIssueKey` is additionally **unique** in the database. The label stops a duplicate
being created in Jira; the constraint stops two defects claiming one issue in QAMS. Neither
substitutes for the other.

## Why one attempt table with an action column

The execution sync uses two tables, and ADR-0004 sets out why: a transition speaks for an issue
key that many runs share, while a comment speaks for one run, so the two are read by different
queries at different grains and sharing a table would break both.

None of that applies here. A defect owns its issue outright, so creating it, commenting on it
and transitioning it all speak for exactly one defect, and the query that matters reads all
three together as one timeline on the defect screen. Two or three tables would mean two or
three queries to answer one question.

The cost is that `JiraSyncOutcome.ABANDONED` cannot occur on a `COMMENT` row, because comments
are never retried. That is a state the column permits and the data never contains — the exact
thing ADR-0004 refused for the execution tables. It is accepted here because the alternative
splits a single timeline across three tables to encode a fact that one sentence of schema
comment states more clearly.

## Why closure, and not resolution, moves the issue

`RESOLVED` means someone believes they fixed it. `CLOSED` is the step QAMS gates on retest
evidence or a closure rationale, which is the check that decides whether the fix actually
worked — and a defect can move from Resolved back to In Progress, which is what makes the
distinction load-bearing rather than pedantic. Transitioning at Resolved would close a Jira
issue before anyone had verified anything.

Reopening a defect does **not** reopen its Jira issue. QAMS never moves an issue backwards,
which is the rule ADR-0003 already set for executions and is unchanged here: "not done" is a
statement about what QAMS must not claim, not an instruction to move someone else's ticket.

Because a retry runs long after the request that queued it, the transition re-reads the
defect's status rather than trusting the caller, and records a `SKIPPED` attempt when the
defect is no longer Closed. Without that, a retry of a transition that failed before a reopen
would close the issue for work that is back in progress.

## Why the project is on the Product and not in the environment

This was `JIRA_DEFECT_PROJECT_KEY`, a single deployment-wide variable, for exactly as long as
it took to ask what happened with more than one product.

QAMS holds a Product → Module → Feature → Requirement hierarchy, and a defect reaches a product
through the one test case it was raised against. A team with four products in QAMS and four
matching Jira projects had no way to say so: every defect landed in one project regardless of
what it was raised against, and the mismatch was silent — the bug appeared, in the wrong place,
looking exactly like a bug that had appeared in the right one.

So the key moved onto `Product`, editable in the Catalogue by the roles that already administer
it. Three consequences:

- **The switch moved with it.** There is no global on/off any more. A product with no key
  raises nothing, and that is the default for every product, so the feature is still off until
  someone deliberately turns it on — the property the variable used to carry, now expressed per
  product instead of per deployment.
- **Screens ask a per-row question.** "This defect has no bug" is only worth reporting when its
  product raises bugs at all. A single flag for the screen would put "not raised in Jira" on
  every defect of every unrouted product, forever, reporting configuration as though it were a
  fault.
- **A blank field has meaning.** Clearing the key is how a QA Lead stops a product raising bugs,
  so blank must resolve to "none" rather than fail validation — while an update that omits the
  field entirely must leave it alone, or an edit to a product's name would silently disconnect
  it. That is the same distinction `updateExecution` draws for an execution's issue key.

The obvious objection is that this puts integration configuration in the database, where the
rest of the Jira settings are deployment-managed environment variables and deliberately so. The
answer is that the reason those are in the environment does not apply here. They are
**secrets** — a client secret, an encryption key, tokens — and `jira-config.ts` refuses to
expose them at any role because a settings screen is an API that returns its settings. A project
key is not a secret and carries no access: it names a project, and anyone who can reach the Jira
site can already list every one of them. What it actually is, is a fact about a product, and it
belongs where the product's other facts are.

The issue **type** stayed in the environment, and the asymmetry is deliberate. It describes how
a Jira site names its types, is the same for nearly every project on one site, and has a default
that is right unless someone renamed it. Putting it on every product would be four places to
write `Bug`. The honest limit: a site where one project renamed its issue type and another did
not cannot express that, and fixing it would mean inventing policy the knowledge base does not
establish.

## Why priority and severity are text, not Jira fields

QAMS priority and severity are controlled values a QA Lead maintains. Jira's priority is a
per-instance field whose allowed names the deployment chooses, and sending an unrecognised one
does not degrade gracefully — Jira refuses the **whole create** with a 400. One mismatched
value would mean no bug is ever raised for any defect.

Carrying both in the description states them plainly, cannot fail, and needs no mapping table
kept in step with two systems at once. A deployment that wants them as real Jira fields needs a
mapping policy, and that is a QA Lead decision this knowledge base does not currently define.

## Consequences

- A product that names no Jira project is completely unaffected: no calls, no attempt rows,
  no queries — even where the deployment is fully connected to Jira for execution transitions.
- A defect raised while Jira is unreachable is still a defect. The bug arrives when the retry
  queue is next worked, or never, and the defect screen says which.
- The retry queue is worked by the same endpoint as the execution queue, and reports the two
  sets of tallies separately — an operator reading "3 failed" needs to know whether three
  tickets did not close or three bugs were never raised.
- QAMS now writes records into a system it does not own. The escaping rules ADR-0004
  established are load-bearing here for the same reasons, and are reused rather than restated.
