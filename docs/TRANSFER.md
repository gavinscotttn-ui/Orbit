# Backing up, restoring, and moving to another computer

Three things people actually need, in the order they need them.

---

## Moving your vault to another computer

Orbit is designed for this. A vault made on a Mac opens on Windows and the other
way round; a vault made on an Intel Mac opens on an Apple Silicon one.

**In Orbit → Settings → Vault, backups & transfer → Prepare for transfer.**

That does three things:

1. **Flushes the write-ahead log into the database file.** This is the step
   people skip and then lose a fortnight's work. SQLite writes recent changes to
   a separate `-wal` file; copying `orbit.sqlite` on its own without
   checkpointing leaves those changes behind.
2. **Checks the vault is complete** — the database passes its integrity check,
   no links are broken, and every attachment the database expects is present.
3. **Tells you what will not come with you**, which is the honest part.

Then:

1. **Quit Orbit.** Not minimise — quit. The lock file is only released on a
   clean close.
2. **Copy the whole vault folder.** All of it, including files beginning with a
   dot. A USB stick, an external drive, a ZIP file, whatever suits.
3. On the other computer, open Orbit and choose **Open an existing vault**, then
   pick the folder you copied.

That is all. There is no export step, no import step and no account.

### What does not come with you

| | Why |
| --- | --- |
| Permission to show desktop notifications | Granted per computer by the operating system. Turn it back on in Settings. |
| Window size and position | A property of the screen you are looking at. |
| The recent-vaults list | A property of that computer. |
| Any external account you had connected | Credentials are held by the operating system's keychain and are bound to that machine. You sign in again. |
| Scheduled reminders while Orbit is closed | Orbit has no background service. Reminders appear when you open it. |

Everything else — records, attachments, currency, locale, enabled areas, theme,
change history — travels.

### If the folder has moved and Orbit cannot find it

The opening screen lists recent vaults and marks any it cannot find. Use
**Open an existing vault** and point it at the new location; Orbit recognises it
by the identity in its manifest and updates the list.

### What not to do

- **Do not keep a live vault in a syncing folder** — Dropbox, OneDrive, iCloud
  Drive, Google Drive — while Orbit is running. Those services copy files
  underneath a running database, which corrupts SQLite. Sync a ZIP of a closed
  vault, or sync the `backups/` folder.
- **Do not open the same vault from two computers at once.** Orbit's lock file
  catches this on a local disk and warns on a network share, but a sync client
  can defeat any such check.
- **Do not copy `orbit.sqlite` on its own** while Orbit is open. Copy the whole
  folder, after preparing for transfer.

---

## Backups

**Settings → Vault, backups & transfer → Back up now.**

Backups go into `backups/` inside the vault, each in its own timestamped folder
with a `backup.json` describing what it is.

They are taken with **SQLite's own online backup API**, which produces a
consistent snapshot even if something is being written at that instant. A plain
file copy of an open database can capture a torn state; this cannot.

**Back up with files** also copies the attachments. Without it the backup is the
database only — which is usually what you want, because attachments are
content-addressed and never modified in place, so the live `attachments/` folder
is effectively append-only.

Orbit takes a backup automatically:

- **before any schema upgrade**, and refuses to upgrade if the backup fails;
- **before any restore**, so a mistaken restore can itself be undone.

### Backups are inside the vault

Which means a copy of the vault carries its backups. It also means a backup does
not protect you against losing the drive. **Keep a copy of the whole vault
folder somewhere else.** Orbit cannot do that for you, because Orbit does not
touch the network.

---

## Restoring

**Settings → Vault, backups & transfer →** pick a backup **→ Restore.**

You will be asked to type the word `restore`. This is deliberate: restoring
replaces everything with the state at that moment, and anything added since is
gone.

What happens:

1. A fresh backup of the **current** state is taken first, labelled
   `pre-restore`.
2. The vault is closed and its `-wal` and `-shm` files removed.
3. The snapshot is copied into place through a temporary name and renamed, so an
   interrupted copy cannot leave a half-written database where the real one was.
4. The vault is reopened, migrated if the backup is older than the build, and an
   integrity check is run.
5. The search index is rebuilt, because the restored database has its own and it
   may be older than the attachments now sitting beside it.

If step 3 fails, Orbit reopens the vault as it was and says what went wrong.

---

## Checking a vault

**Settings → Vault, backups & transfer → Run a check** verifies:

- the database passes SQLite's own `integrity_check`;
- no foreign key is broken;
- every attachment the database expects is present on disk, and the right size;
- nothing is sitting in `attachments/` that no record claims.

**Verify every file** goes further and re-computes the SHA-256 of every
attachment against what was recorded. It is slower, and it is the check that
catches a file that has been quietly corrupted rather than merely lost.

An unclean shutdown triggers the first check automatically on the next open.

---

## Recovering from an interrupted write

SQLite in WAL mode recovers automatically from a crash: the next open replays or
discards the log. Orbit adds two things on top.

- The manifest's `cleanShutdown` flag is false while the vault is open. Finding
  it false means the last session did not end tidily, so an integrity check runs
  before you are shown anything.
- Attachments are written to a temporary name and renamed into place, so an
  interrupted write cannot leave a truncated file at a path that claims to be a
  complete one.

If a vault will not open at all, the `backups/` folder inside it is the first
place to look, and every backup there is a plain SQLite file you can inspect
with any tool.
