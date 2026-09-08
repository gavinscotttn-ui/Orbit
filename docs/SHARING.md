# Sharing, assignment and history

Short version: **Orbit is a single-user application, and nothing in it grants
anybody access to anything.** This document exists because the schema contains
words like `assignee_person_id` and `household`, and words like that invite a
reasonable person to assume there is a permission system behind them. There is
not.

---

## What "assigned to" means

`tasks.assignee_person_id`, and every field like it, is **a label**. It says
who is meant to do the thing. It is exactly as authoritative as writing a name
on a Post-it note, and it has precisely the same enforcement behind it.

Specifically, assigning a task to a person in Orbit:

* does **not** notify them — Orbit has no network, no email, no messaging
* does **not** give them access to the vault, the record, or anything else
* does **not** hide the record from anyone
* does **not** create an account, an identity, or a login for them

A `person` record is a record about somebody. It is not a user.

The application says this where it matters, not only here: the assignment field
carries the explanation in its help text, so nobody has to read a document to
learn that their partner will not be told.

---

## The household model

Orbit models a household — people, pets, vehicles, rooms, shared bills, who
usually does the school run — because that is what a life looks like. Modelling
a household is not the same as supporting several *users*.

One vault, one person operating it, at one computer at a time (enforced by the
lock file — see [VAULT-FORMAT.md](VAULT-FORMAT.md)). Two people can share a
vault the way two people share a filing cabinet: by taking turns, or by each
keeping their own.

---

## What Orbit does have: history

Every create, update and delete is recorded in the `activity` table with a
**before-snapshot** of the record. That gives you:

* a change history on every record's detail view — what changed, when, and from
  what to what
* **undo** on a delete, offered in the toast at the moment it happens
* restoring an earlier version of a record from its history

This is a single-user audit trail: it answers "what did I do to this record and
can I put it back", which is the question that actually comes up. It is not an
access log, because there is nobody else to log.

---

## Why real sharing is not built

Genuine multi-person sharing needs four things, and Orbit has none of them:

1. **Identity** — a way to know who somebody is. Orbit has no accounts, by
   design ([SECURITY.md](SECURITY.md) §2).
2. **Transport** — a way for two copies to reach each other. Orbit makes no
   network requests, by design and by enforcement
   ([SECURITY.md](SECURITY.md) §1).
3. **Permissions** — a way to say this person may see the car but not the
   medical records. Nothing in the schema enforces visibility.
4. **Conflict resolution** — a way to reconcile two people editing the same
   record while apart. Last-write-wins on a shared folder is not conflict
   resolution; it is data loss with a delay.

Any product that has three of the four and ships anyway produces the worst
outcome: people believe their information is shared or protected when it is
neither.

**Do not attempt to share a live vault via Dropbox, OneDrive, iCloud Drive,
Google Drive or a network share.** A sync client copies files underneath a
running SQLite database and corrupts it. See [TRANSFER.md](TRANSFER.md), "What
not to do", for what to do instead.

---

## What could be built on this, later

The groundwork that exists and does not preclude it:

* every record has a **stable id** that survives export, transfer and reimport
* every change is already recorded, with timestamps and before-snapshots
* the bundled SQLite includes the **session extension**, which produces
  changesets — the raw material for a real sync protocol
* `vaultId` in the manifest distinguishes one vault from another, so two vaults
  could be told apart rather than blindly merged

What it would still need is the four things above, in that order, plus an honest
account of what each one implies for privacy. Until then, the interface says
"not built", and so does [FEATURE-STATUS.md](FEATURE-STATUS.md) §20.

---

## Sharing that does work today

Exporting. Any record type exports to CSV or JSON, the whole vault is a folder
you can copy, and a backup is a plain SQLite file. If somebody needs your
insurance details, export them and send the file by whatever means you already
trust. That is sharing under your control, which is the only kind an offline
application can honestly offer.
