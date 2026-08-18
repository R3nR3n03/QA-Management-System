# QA Management System

The vocabulary of this codebase — the words that mean something particular here, and which
of several near-synonyms to use. A glossary and nothing else: no rules, no shapes, no
implementation. Policy lives in [`docs/`](docs/README.md), engineering decisions in
[`docs/adr/`](docs/adr/README.md).

Terms are added as they are resolved, so this is not yet complete.

## The catalogue hierarchy

**Product**:
The top of the catalogue hierarchy. The only level carrying a version and a status; a
module or feature shown with either is displaying its product's.
_Avoid_: application, system

**Module**:
A named grouping of features inside one product — the second level of the hierarchy, and a
record with a `MOD###` business ID.
_Avoid_: component, area, section. **Never** use "module" for a part of the software
itself; that is a **screen** (what a viewer opens) or a **domain service** (what enforces
its rules). "The catalogue module" is ambiguous in the one direction that matters here.

**Feature**:
A unit of behaviour inside a module, and the level test cases are written against. The
deepest level the [catalogue tree](docs/adr/0001-catalogue-tree-stops-at-feature.md) draws.
_Avoid_: function, capability, story

**Requirement**:
A single statement of required behaviour under one feature, and what the traceability
matrix measures coverage against.
_Avoid_: spec, rule, acceptance criterion

**Statement**:
A requirement's text. A requirement has no name — the statement is its label everywhere it
appears, which is why it reads as a sentence rather than a title.
_Avoid_: description, text, title

**Business ID**:
The human-facing identifier of a record — `PROD001`, `MOD004`, `FEAT012`, `REQ007`,
`TC-<tag>-0001`, `BUG-0001`. Unique, immutable once created, and the identifier a person
pastes into a chat window. Distinct from the row's UUID, which no person ever sees.
_Avoid_: code, key, reference, ID (unqualified)

## The catalogue screen

**Catalogue explorer**:
The screen that browses the hierarchy: a tree on the left, one record's detail on the
right. The screen as a whole.
_Avoid_: catalogue module, catalogue page

**Tree**:
The navigation panel of the explorer, drawing Product → Module → Feature.
_Avoid_: tree view, browser, sidebar, navigator

**Branch**:
One expandable node of the tree together with the children it draws — a product with its
modules, or a module with its features.
_Avoid_: subtree, folder

**Selection**:
The record the detail panel is showing. Lives in the URL, and is one record at a time.
_Avoid_: active record, current node, focus (which means where the keyboard is, and moves
independently)

**Open**:
Whether a branch is expanded. Deliberately separate from selection: choosing a record and
looking inside one are two different intentions, and conflating them is what made the tree
read as broken.
_Avoid_: expanded, active

**Hit**:
One record returned by a search, carrying its ancestry. What the explorer lists instead of
a tree while a needle is present.
_Avoid_: match, result, row

**Needle**:
The text a viewer typed into a search box, before anything has been matched with it.
_Avoid_: query, term, filter

## The execution

**Execution**:
One run of one or more approved test cases, assigned to one tester, moving through three
lifecycle states. "Run" says the same thing and is used freely in prose — both words are
right, and the better-reading one wins in any given sentence.
_Avoid_: **execution plan**. There is no record by that name, and the phrase already means
something else entirely in a database. Also avoid test round, test pass.

**Purpose**:
One line saying what a run exists to check — "Sprint 24 regression, Chrome". Written when
the run is planned, and the headline a reader scans a list of runs by. Never an identifier
and never unique: several runs share one purpose whenever the same check is repeated across
browsers or reruns, and `EXE-####` stays the only thing that identifies a run.
_Avoid_: name, title, label. A **name** identifies a catalogue record and this identifies
nothing; **title** is a test case's headline; **label** is the text beside a form control.

**Planned**:
The first lifecycle state: the execution exists and what it covers is fixed, but nobody has
started it. "Plan an execution" is the act that creates one, and it produces an execution in
this state — never a separate record of its own.
_Avoid_: draft, scheduled, pending, plan (as a noun)

**Feature group**:
One feature and the approved test cases under it, as the planning picker lists them — the
unit a planner opens, and the unit they can take whole in one click. Distinct from a
[branch](#the-catalogue-screen), which belongs to the catalogue tree and draws catalogue
records; a feature group belongs to the picker and draws test cases. The picker is not a
tree and has only this one level.
_Avoid_: bucket, section, folder, node. Plain "group" is fine in prose about the picker,
where nothing else is grouped.

## Jira

**Jira issue key**:
The identifier of a Jira issue — `PROJ-123`. It reaches QAMS two ways, and they are
opposites. On an **execution** a person types it in, naming the task the run is against; it
is the only thing anyone ever tells QAMS about Jira. On a **defect** QAMS writes it, having
raised that issue itself. Everything else QAMS holds is a record of what it did with the key.
_Avoid_: backlog ID, ticket number, issue ID, Jira reference. A *backlog* is a Jira view,
not an identifier, so "backlog ID" names nothing that exists.

**Transition**:
The act of moving a Jira issue from one status to another. Jira has no way to *set* a
status — a transition is executed, and a workflow may refuse one that is not legal from
the issue's current status. Say "transition the issue", never "set the status".
_Avoid_: set status, update status, change state

**Result comment**:
The comment QAMS posts on a Jira issue saying what one finalized run found. A **report**,
where a transition is a **claim**: the comment states what was verified and by whom, and
only a transition asserts that the work is finished. That difference is why the two are
separate acts rather than two halves of one, and why they answer to different rules. Say
"post a result comment on the issue", never "comment the issue".
_Avoid_: note, update, summary. Also **report** as a bare noun — a QAMS *report* is
something a reader opens, like the traceability matrix, and this is something a reader is
sent.

**Raise** (a Jira issue):
What QAMS does to Jira when someone records a defect: it *creates* a bug there. The word is
reserved for creation, and creation is the one thing QAMS does in Jira that it cannot take
back — a transition can be transitioned again and a comment is noise, but a duplicate issue
is somebody else's cleanup. Say "raise the issue for a defect", never "sync the defect".
_Avoid_: sync, push, file, log, open. *Sync* is the worst of them: it suggests two systems
converging, and Jira never writes back to QAMS.

**Adopt** (a Jira issue):
What a retried create does when it finds an issue an earlier attempt already raised, instead
of raising a second one. The issue existed and was unrecorded; adopting it binds it to the
defect it always belonged to. A success, not a failure, and worth distinguishing from a
plain creation whenever a reader asks what happened.
_Avoid_: reuse, link, attach, claim.

**Lifecycle comment**:
The comment QAMS posts on a defect's issue when that defect changes state, carrying the
rationale that transition required. A **report**, on exactly the footing a result comment
has: it narrates, and only the transition at closure claims the work is finished.
_Avoid_: status update, sync comment.

## Time

**Stamp**:
One instant as a reader sees it — `2026-08-17 14:30`, or `2026-08-17 02:30 PM`, to the minute.
A *rendering* of an instant and never the instant itself, which is why a stamp has a zone and
a clock and the record behind it has neither: the record holds UTC. Two screens showing one
record must show the same stamp, and that requirement is why there is a single formatter
rather than one per screen.
_Avoid_: timestamp, date, time. A **timestamp** is what is stored — say "the record's
timestamp" for the UTC instant and "the stamp" for what is drawn from it; using one word for
both is what makes a conversation about zones impossible to follow.

**Display preferences**:
The pair a person sets about how stamps are drawn for them: their [viewer
zone](#time) and whether their clock reads 12- or 24-hour. Named as a pair because they are
decided together, saved together and audited together — one intention, not two. Nobody sets
another person's, and neither one is ever consulted by a query.
_Avoid_: settings, options, profile. **Settings** in this codebase means deployment
configuration, which is the opposite of this: nobody's, rather than one person's.

**Organization zone**:
The single zone this deployment speaks in when there is nobody to speak to — the stamp on a
Jira comment, read by people who are not QAMS users and may not be in this organization.
Deployment configuration, like the public address, and never any person's property. It
governs **no query**: nothing in QAMS buckets by calendar day, so this is presentation to
outsiders and not a business day. See
[ADR-0007](docs/adr/0007-a-zone-for-readers-and-a-zone-for-outsiders.md).
_Avoid_: server zone, default zone, system zone. And **the timezone**, unqualified — the
bare phrase is what collapses this back into the viewer zone, which is the one mistake this
pair of terms exists to prevent.

**Viewer zone**:
The zone one signed-in reader's stamps are rendered in, held on their own record and set by
nobody else — half of their [display preferences](#time). Purely presentation: changing it
moves what a person sees and never which records they get back. Unset means they have never
expressed a preference, which is not the same as having chosen the organization's.
_Avoid_: user timezone, local time, preferred timezone. And **the timezone**, for the reason
above.

## Automation

**Spec**:
One Cypress file. The word is Cypress's own and is free to take here: this glossary already
_avoids_ "spec" as a name for a [requirement](#the-catalogue-hierarchy), so nothing else
claims it.

**Never** call a spec a **test case**. A test case is a record in the catalogue, carrying a
`TC-` business ID, authored by a person and approved by another; a spec is a file in a
repository. The same bar applies to **run**, **execution** and **result**: those three name
what QAMS records about the software under test, and reusing them for what Cypress does makes
it impossible to tell which of the two any given sentence is about — the failure this section
exists to prevent.
_Avoid_: test, test case, scenario, e2e test

**Check**:
One spec's observation of one test case at one instant. A **report**, where an
[execution](#the-execution) is a **claim** — the same distinction a [result comment](#jira)
draws against a transition, and the reason the two are separate records rather than one. A
machine reports what it saw; only a person signs their name to what a test case did. Say "the
check failed", never "the test case failed": the case did not do anything.
_Avoid_: automated test, automated result, test result, automated execution

**Check batch**:
One uploaded results file and the checks it produced — the unit a QA Lead opens to read what an
upload did, and the only thing that groups checks. Deliberately not an **import**: a workbook
import reconciles a source against records that already exist, and a batch reconciles nothing,
because every check in it is new. Borrowing the word would import the expectation.
_Avoid_: import, upload, check run, run
