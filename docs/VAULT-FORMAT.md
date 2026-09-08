# The Orbit vault format

**Format version 1 · Database schema version 10**

A vault is an ordinary folder. Everything a person keeps in Orbit lives inside
it, addressed by paths relative to the folder's root. Nothing outside the folder
is needed to read it, and nothing inside it records the computer that wrote it.

Close Orbit, copy the folder to another computer — Windows or macOS, Intel or
Apple Silicon — open it there, and everything is present: records, attachments,
preferences and the links between them.

---

## Layout

```
My Orbit Vault/
├── orbit-vault.json        Identifies the folder and records its versions
├── README.txt              A plain-text explanation for whoever finds it later
├── data/
│   ├── orbit.sqlite        Every record, in a standard SQLite database
│   ├── orbit.sqlite-wal    Write-ahead log (transient)
│   └── orbit.sqlite-shm    Shared memory index (transient)
├── attachments/
│   └── 3f/a9/3fa9c1…e7.pdf Files, named by the SHA-256 of their contents
├── preferences/
│   └── portable.json       Reserved; portable preferences currently live in the
│                           database's `settings` table
├── backups/
│   └── 2026-09-08T…-manual/
│       ├── orbit.sqlite    A consistent snapshot
│       ├── orbit-vault.json
│       └── backup.json     What it is, when it was taken, and why
├── exports/                Anything you have exported
└── .orbit-lock             Present only while a copy of Orbit has it open
```

## The manifest

`orbit-vault.json` is the file that makes a folder a vault.

```json
{
  "kind": "orbit-vault",
  "vaultId": "vault_m3k…",
  "formatVersion": 1,
  "schemaVersion": 10,
  "name": "My Orbit vault",
  "createdAt": "2026-09-08T09:41:12.004Z",
  "updatedAt": "2026-09-08T13:02:55.118Z",
  "createdByAppVersion": "0.1.0",
  "lastWrittenByAppVersion": "0.1.0",
  "isDemo": false,
  "encryption": "none",
  "cleanShutdown": true
}
```

| Field | Meaning |
| --- | --- |
| `kind` | Constant. A folder without it is not a vault, and Orbit says so rather than guessing. |
| `vaultId` | A random identity that survives moves and renames. Used to recognise a vault that has been moved. |
| `formatVersion` | The on-disk **layout**. Bumped when the folder structure changes. |
| `schemaVersion` | The **SQL schema** of `data/orbit.sqlite`. Bumped by every migration. |
| `name` | A label shown in Orbit. The folder can be renamed independently. |
| `isDemo` | True for the demonstration vault, which is shown with a permanent banner and never mixed with real data. |
| `encryption` | `none` today. See [SECURITY.md](SECURITY.md) — this is not claimed to be more than it is. |
| `cleanShutdown` | False while open. A vault found with `false` gets an automatic integrity check on the next open. |

**What is deliberately absent**: any absolute path, hostname, username, machine
identifier or serial number. A vault carries nothing about the computer it was
used on. This is checked by a test.

## Attachments are content-addressed

An attached file is stored under the SHA-256 hex digest of its own bytes:

```
attachments/<first 2 hex>/<next 2 hex>/<full 64 hex digest>.<extension>
```

The user's original filename is kept in the database and is what they see, what
search matches on, and what they get when they export a copy.

This is not cleverness for its own sake. It removes, by construction, every
cross-platform filename problem that would otherwise break a vault the moment it
crossed from macOS to Windows:

- **Windows reserved names.** `CON.txt`, `PRN`, `LPT1` cannot occur.
- **Forbidden characters.** `: * ? " < > |` cannot occur.
- **Case-insensitive collisions.** `Receipt.PDF` and `receipt.pdf` are two
  records; whether they are one file is decided by their contents, not their
  names.
- **Unicode normalisation.** macOS stores `é` decomposed and Windows composed,
  so the *same* filename can fail to match across platforms. Hex digits have no
  such ambiguity.
- **Path length.** Every path is a predictable length.

A useful side effect: the same photograph attached to five records is stored
once. Deleting one of those records does not delete the bytes while another
still points at them.

## Nothing stores an absolute path

Every attachment row holds a path *relative to the vault root*
(`attachments/3f/a9/…`). Resolving one goes through a single function that
refuses anything escaping the vault — no `..`, no absolute paths, no Windows
drive letters, no UNC paths, no control characters. That check is the same one
used for archive entries and imported files.

Moving the folder changes exactly one thing: the value of the root. This is
covered by an integration test that physically moves a vault to a different
directory, at a different depth, under a different name, and verifies every
record and every attachment.

## What travels, and what does not

| Travels with the vault | Stays on the computer |
| --- | --- |
| Every record | Window size and position |
| Every attachment | Which vault was open last |
| Currency, locale, date format, week start | Recent-vaults list |
| Which Life areas are enabled | Desktop-notification permission |
| Theme and density preference | Per-machine theme override |
| Dashboard layout | Text size and reduced-motion setting |
| The change history behind undo | Log files |

Device settings live in the operating system's per-user application folder.
Deleting them loses a window position; it loses no data.

## Migrations

Migrations are numbered, gapless from 1, and immutable once published. A mistake
is corrected by a **new** migration, never by editing an old one.

On opening a vault whose `schemaVersion` is behind the build:

1. A backup is taken **before the first migration runs**. If the backup fails,
   the upgrade does not start and the vault is left exactly as it was.
2. Each migration runs inside a transaction and is recorded in
   `schema_migrations` before `PRAGMA user_version` is advanced.
3. `PRAGMA foreign_key_check` runs afterwards. Any violation aborts.

Opening a vault whose `schemaVersion` is **ahead** of the build is refused, with
a plain message naming both numbers and stating that nothing has been changed.
Orbit does not attempt to read a format it does not know.

## Concurrency

`.orbit-lock` holds the instance id, process id, a short machine label, and a
heartbeat updated every 30 seconds.

- Same lock object → re-entrant.
- Same machine, dead process → stale, reclaimed automatically.
- Live heartbeat → refused, naming where it is open.
- Heartbeat older than five minutes → refused, but the user may deliberately
  take over after being told what that risks.

The lock file is removed on a clean close, and a running instance only ever
removes a lock it still owns.

**A vault in a syncing folder is not supported.** Dropbox, OneDrive, iCloud
Drive and network shares copy files underneath a running database, which is how
SQLite databases get corrupted. Sync a ZIP of a closed vault instead, or use the
`backups/` folder. Orbit says this in the interface as well as here.

## Reading a vault without Orbit

`data/orbit.sqlite` is a standard SQLite 3 database. Any SQLite tool opens it.
Attachments are ordinary files. If Orbit vanished tomorrow, the data would still
be readable, which is the point of choosing this format over anything
proprietary.
