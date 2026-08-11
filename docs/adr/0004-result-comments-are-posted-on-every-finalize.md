# Result comments are posted on every finalize

Status: accepted

Finalizing a test execution that carries a Jira issue key posts a **result comment** on that
issue — a report of what the run found — whatever the run's derived result was. This is a
second, deliberately weaker Jira write sitting beside the transition that
[ADR-0003](0003-jira-sync-is-decoupled-from-finalize.md) describes, and almost every rule
here is weaker than its equivalent there: a looser trigger, no retry budget, no recovery,
and a deployment flag that leaves it off until someone asks for it.

Policy for this lives in `../architecture.md#Jira execution sync` and
`../api-and-security.md#Jira execution sync interface`. This record is only the engineering
reasoning; where the two disagree, those documents are right.

## Why

**A comment reports; a transition claims.** ADR-0003 refuses to fire on a single finalize,
because one Jira task routinely carries a browser matrix, a re-run and a regression pass, and
moving the ticket to Done when the first of them finishes tells the board a lie. None of that
reasoning transfers to a comment. "Run EXE-0042 finished: 9 passed, 2 failed, 1 blocked" is
true the moment it is written and stays true no matter what the other runs do. The stricter
gate would in fact make the feature useless in the case it is most wanted: gated on
all-Finalized-and-all-Pass, a comment could only ever appear on a ticket that had already gone
Done, and would never once mention a failure.

**Sharing `JiraSyncAttempt` would have silently broken the transition.** That table has no
column saying which kind of write a row describes, and three separate places read every row as
the transition's story. `settleJiraSync` skips the transition when *any* `SUCCEEDED` row exists
for the key — so the first successful comment, which now happens on every finalize, would have
suppressed the transition for that issue forever. `loadQueue` treats a `SUCCEEDED` or
`ABANDONED` row as the key being settled and drops it from the retry queue. And the retry
worker builds its queue from `FAILED` rows grouped by key and replays each one by calling
`transitionToDone`, *without* re-checking eligibility — so a failed comment on a failing run
could have transitioned a ticket to Done that never qualified. A `kind` discriminator fixes all
three, and leaves the next person one forgotten filter away from reintroducing any of them. A
separate table makes those queries structurally unable to see comment rows.

**A missing comment is cosmetic, and pretending otherwise buys machinery nobody needs.** QAMS
is the system of record; the results are safe in it whether or not Jira ever hears about them.
A retry budget, an `ABANDONED` state and a Lead-facing recovery path are the right weight for a
ticket stuck open, and the wrong weight for a comment that did not post. Recording the attempt
is still mandatory — `api-and-security.md` requires every sync attempt to be audited — so the
failure is visible; it is simply never chased.

**Wiki markup keeps the body small, and moves the cost to escaping.** Jira's v3 API takes
comments as ADF, a JSON document tree; v2 takes a plain wiki-markup string, which is a fraction
of the code for the same rendered result. The bill for that choice is that tester-written text
— case titles, block reasons, actual results, the run's purpose — is now interpolated into a
markup language, where `{code}` opens a block that swallows the rest of the comment and
`[text|http://elsewhere]` becomes a real link authored by a QAMS bot in a ticket QAMS does not
own. Escaping that text is not a nicety here; it is the whole safety of the feature.

**Turning this on for an existing deployment would surprise a team that never asked.** A
transition is invisible until someone looks at the status. A comment is conversation, in a
space shared with people who have no idea QAMS exists. An integration that starts writing into
tickets on the day of an upgrade is one a team switches off entirely, so it stays off until a
deployment sets `JIRA_COMMENT_ON_FINALIZE`.

## Considered

- **The same trigger as the transition.** Consistent, and useless: the comment would appear
  only on tickets already moved to Done and could never report a failure.
- **A `kind` column on `JiraSyncAttempt`.** One migration instead of a new table, and rejected
  on the three read sites above — the failure mode of forgetting one is a silently
  mis-transitioned or never-transitioned ticket, which is exactly the class of bug this
  integration exists to avoid.
- **Retry parity with transitions.** Rejected as the wrong weight for a cosmetic loss, and
  because comments have no natural idempotency: a run finalizes once, so a retried comment that
  actually succeeded the first time would post twice.
- **A QA Lead endpoint to re-post a failed comment.** Rejected with the retry budget. It brings
  RBAC, a duplicate-comment risk, and a second recovery story for a Lead to learn, to recover
  something the run screen already links to.
- **ADF on the v3 API.** The structurally safe option — text nodes are literal, so no escaping
  problem exists — and rejected because it is markedly more code and a malformed tree is a
  runtime 400. The escaping it would have made unnecessary is instead written and tested.
- **On wherever Jira is enabled.** Simplest configuration story, rejected on the surprise: it
  writes into other people's tickets without anyone opting in.

## Consequences

- Tester-written text now reaches another company's renderer. `escapeWikiMarkup` is
  load-bearing, and a defect in it corrupts a ticket QAMS has no ability to repair.
- A tester who has never connected their Jira account writes a failed attempt row on every
  finalize of a linked run. That is volume rather than harm — nothing retries it — and the
  reason surfaces on the run screen, where that tester can act on it.
- A comment and a transition are attempted in sequence, each with its own deadline, so a
  *hanging* Jira adds roughly twice `JIRA_TRANSITION_TIMEOUT_MS` to a finalize whose work is
  already committed. They are deliberately not sharing one budget: the comment goes first, and a
  shared budget would let the disposable half starve the half that carries meaning.
- QAMS now writes to Jira on runs that **fail**, which it never did before. Active tickets get
  more traffic from us, and precisely on the tickets people are already arguing about.
- A posted comment can never be corrected or withdrawn by QAMS. The created comment's id is
  stored against the attempt so that a later decision could; nothing reads it today.
- The comment body is capped — 200 characters per free-text field, 50 non-passing cases, and a
  ceiling on the whole body below the 32,767 characters Jira accepts — so for a large failing
  run the comment reports the shape of the failure and the QAMS link is the real answer. The
  two smaller caps bound what a reader sees and the last one bounds what is sent, which are
  different numbers: escaping runs after the field cap and can nearly double a hostile field,
  so the body is measured and cases are dropped until it fits. A reader who is not told about
  truncation would draw wrong conclusions, so the body says how many cases it left out.
- A backslash a tester typed reaches Jira as a forward slash. Jira's wiki markup has no
  notation for a literal backslash — `\\` is its forced line break — so escaping one the way
  every other special character is escaped would insert a line break, which both rewrites the
  text and returns the following characters to the start of a line, where `h1.` and `bq.` are
  structural again. Substitution is the only way to keep the escaping promise, and it is the
  one place this feature knowingly alters what a person wrote.

Decided with the QA Lead on 2026-08-11.
