# Portable mode

Running Orbit from a USB stick, an external drive, or any folder you carry
around, with the vault travelling beside the application.

This is a convention, not magic, and it is deliberately visible: Orbit never
silently adopts a vault it found. It shows you what it found, where, and why it
thinks that, and you confirm.

---

## The short version

Put a folder named **`Orbit Vault`** next to the Orbit executable:

```
E:\Orbit\
├── Orbit.exe            ← the Windows portable build
└── Orbit Vault\         ← your vault
    ├── orbit-vault.json
    ├── data\orbit.sqlite
    └── attachments\
```

Launch `Orbit.exe`. The first-run screen shows *"A vault was found beside the
application"* with the path and the reason, and **Open it** opens it.

---

## The two conventions

Implemented in [`src/main/vault/portable.ts`](../src/main/vault/portable.ts).
Both are checked on every launch; the pointer file wins if both are present.

### 1. An adjacent folder named `Orbit Vault`

Simplest. The folder must actually look like a vault — it must contain
`orbit-vault.json` — or Orbit ignores it rather than offering to open an empty
directory.

### 2. A pointer file named `orbit-portable.txt`

For when you want the vault somewhere other than immediately beside the
executable. Place `orbit-portable.txt` next to the application. Orbit reads the
first non-empty line that does not begin with `#` and treats it as the vault
path:

```
# Orbit portable pointer. First non-comment line is the vault path.
# Relative paths are relative to this file's folder.
../Vaults/Household
```

Absolute paths are accepted too, and so are relative paths that step up a level
(`../`). That is intentional: this file is deliberate local configuration
written by the person who set up the drive, not untrusted input arriving from
elsewhere. Paths *inside* an open vault are a different matter and go through a
single choke point that refuses to escape it
([`VaultPaths.resolveInside`](../src/main/vault/paths.ts)).

A malformed or unreadable pointer file is ignored, and the application starts
normally. A broken text file must never stop you reaching your data.

---

## Where "next to the application" actually is

`distributionDirectory()` resolves this per platform, because getting it wrong
is the classic way portable mode breaks on exactly one operating system:

| Platform | `process.execPath` | Portable base |
| --- | --- | --- |
| Windows | `E:\Orbit\Orbit.exe` | `E:\Orbit\` |
| macOS | `/Volumes/Stick/Orbit.app/Contents/MacOS/Orbit` | `/Volumes/Stick/` — the folder **containing** the `.app` |
| Development | — | the project root (`process.cwd()`) |

### macOS: never inside the bundle

On macOS the portable base is the folder containing `Orbit.app`, and never a
folder inside it. Writing user data into an application bundle breaks its code
signature, and on a quarantined, translocated, or read-only volume it simply
fails. So a macOS portable layout looks like this:

```
/Volumes/Stick/
├── Orbit.app
└── Orbit Vault/
```

Note also that macOS may *translocate* an unsigned, quarantined app — it runs
from a randomised read-only path, and then nothing is "next to" it in the sense
you meant. If portable mode does not find your vault on macOS after copying the
app from a download, clear the quarantine attribute
(`xattr -dr com.apple.quarantine /Volumes/Stick/Orbit.app`) or sign the build.
This is a macOS behaviour, not something Orbit can work around, and pretending
otherwise would be unhelpful.

---

## The Windows portable build

`Orbit-<version>-portable.exe` is a self-extracting executable. It unpacks to a
temporary folder and runs from there — but `distributionDirectory()` is resolved
from the executable's own location, so the `Orbit Vault` folder goes next to the
**`.exe` you double-clicked**, not next to the unpacked temporary copy.

`unpackDirName: Orbit` and `requestExecutionLevel: user` are set so the unpack
location is stable and no administrator prompt appears.

If you prefer a fully self-contained folder with no unpacking, use the NSIS
installer and point it at a folder on the removable drive.

---

## What is *not* portable

Portable mode moves the vault and the application. It does not move:

* **Device preferences** — theme override, text scale, reduce-motion, auto-lock
  minutes, OS-notification opt-in, and the recent-vaults list. These live in the
  per-machine application folder and are intentionally per-device. Your vault is
  yours; your screen is that computer's.
* **Operating-system notification permission**, which is granted per machine and
  per user by the OS, not by Orbit.
* **Reminders while Orbit is not running.** Orbit has no background service. It
  computes what needs attention when it is open.

See [VAULT-FORMAT.md](VAULT-FORMAT.md), "What travels, and what does not", for
the full list.

---

## Safety on removable drives

* **Orbit never silently falls back.** If the chosen folder is missing,
  unwritable, or the drive has been pulled, it says so and stops. It does not
  quietly write your records into an application folder somewhere so that they
  can be lost later.
* Writability is established by an **actual test write**, not by asking the
  operating system's permission bits — `probeWritable()` in
  [`src/main/vault/paths.ts`](../src/main/vault/paths.ts). Read-only volumes,
  full disks and permission-denied network shares all fail here rather than
  three screens later.
* **Eject properly.** Close the vault (or quit Orbit) before removing the drive.
  SQLite in WAL mode has a `-wal` and `-shm` file beside the database; pulling
  the drive mid-write is exactly the situation the recovery path in
  [TRANSFER.md](TRANSFER.md), "Recovering from an interrupted write", exists for.
* **Two computers at once is not supported.** A lock file with a heartbeat
  detects a vault already open elsewhere and offers a deliberate takeover rather
  than letting two copies corrupt each other. Cloud-synced folders (Dropbox,
  OneDrive, iCloud Drive) and network shares are **not** safe live locations for
  a vault, for the same reason — see [TRANSFER.md](TRANSFER.md), "What not to do".
