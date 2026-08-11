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

## Jira

**Jira issue key**:
The identifier of the Jira task an execution is run against — `PROJ-123`. The only thing a
person ever tells QAMS about Jira; everything else QAMS holds is a record of what it did
with the key.
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
