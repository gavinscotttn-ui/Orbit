import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultManager } from '../../src/main/vault/manager.js'
import { AttachmentService } from '../../src/main/services/attachments.js'
import { SCHEMA_VERSION } from '../../src/shared/vault.js'
import { newId } from '../../src/shared/domain/ids.js'

const APP_VERSION = '0.1.0-test'

let workspace: string

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'orbit-test-'))
})

afterEach(() => {
  try {
    // Restore permissions before cleanup; a read-only test dir resists rm.
    chmodSync(workspace, 0o755)
  } catch {
    /* ignore */
  }
  rmSync(workspace, { recursive: true, force: true })
})

function seedPerson(manager: VaultManager, name: string): string {
  const { db } = manager.require()
  const id = newId('per')
  const now = new Date().toISOString()
  db.run(
    'INSERT INTO people (id, display_name, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [id, name, 'person', now, now]
  )
  return id
}

describe('creating a vault', () => {
  it('creates the folder skeleton, manifest and database', () => {
    const manager = new VaultManager(APP_VERSION)
    const root = join(workspace, 'My Vault')
    const result = manager.create(root, { name: 'Household' })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(existsSync(join(root, 'orbit-vault.json'))).toBe(true)
    expect(existsSync(join(root, 'data', 'orbit.sqlite'))).toBe(true)
    expect(existsSync(join(root, 'attachments'))).toBe(true)
    expect(existsSync(join(root, 'backups'))).toBe(true)
    expect(existsSync(join(root, 'README.txt'))).toBe(true)

    expect(result.session.manifest.name).toBe('Household')
    expect(result.session.db.schemaVersion).toBe(SCHEMA_VERSION)
    manager.close()
  })

  it('refuses to create a vault where one already exists', () => {
    const manager = new VaultManager(APP_VERSION)
    const root = join(workspace, 'Vault')
    const first = manager.create(root)
    expect(first.ok).toBe(true)
    manager.close()

    const second = new VaultManager(APP_VERSION).create(root)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.message).toMatch(/already an Orbit vault/)
  })

  it('records a clean shutdown when closed properly', () => {
    const manager = new VaultManager(APP_VERSION)
    const root = join(workspace, 'Vault')
    manager.create(root)
    manager.close()
    const manifest = JSON.parse(readFileSync(join(root, 'orbit-vault.json'), 'utf8'))
    expect(manifest.cleanShutdown).toBe(true)
  })

  it('puts no absolute path, hostname or username in the manifest', () => {
    const manager = new VaultManager(APP_VERSION)
    const root = join(workspace, 'Vault')
    manager.create(root)
    manager.close()
    const text = readFileSync(join(root, 'orbit-vault.json'), 'utf8')
    expect(text).not.toContain(workspace)
    expect(text).not.toContain('/home')
    expect(text.toLowerCase()).not.toContain('hostname')
  })
})

describe('moving a vault to a different path', () => {
  it('keeps every record and every attachment after the folder moves', () => {
    const manager = new VaultManager(APP_VERSION)
    const original = join(workspace, 'original-location', 'Orbit Vault')
    mkdirSync(join(workspace, 'original-location'), { recursive: true })
    const created = manager.create(original, { name: 'Travelling Vault' })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const personId = seedPerson(manager, 'Alan')
    const attachments = new AttachmentService(created.session.db, created.session.paths)

    // Filenames chosen to break naive implementations on at least one platform.
    const awkward: [string, string][] = [
      ['receipt.pdf', 'ordinary'],
      ['CON.txt', 'a Windows reserved name'],
      ['Ré\u0301sumé café.pdf', 'decomposed Unicode'],
      ['Résumé café.pdf', 'composed Unicode'],
      ['invoice: 50% "final" <draft>.txt', 'characters Windows forbids'],
      ['Receipt.PDF', 'a case-only variant'],
      ['日本語の領収書.pdf', 'non-Latin script'],
      ['a'.repeat(300) + '.txt', 'an over-long name']
    ]
    const stored = awkward.map(([filename], index) =>
      attachments.addBuffer(new TextEncoder().encode(`contents ${index}`), filename, {
        link: { entityType: 'person', entityId: personId }
      })
    )
    expect(stored.every((s) => !s.deduplicated)).toBe(true)

    const beforeIds = attachments.listFor('person', personId).map((a) => a.id).sort()
    const beforeNames = attachments.listFor('person', personId).map((a) => a.originalFilename)
    expect(beforeIds).toHaveLength(awkward.length)

    manager.close()

    // The move: a different folder, a different depth, a different name.
    const moved = join(workspace, 'somewhere', 'else', 'entirely', 'Renamed Vault')
    mkdirSync(join(workspace, 'somewhere', 'else', 'entirely'), { recursive: true })
    cpSync(original, moved, { recursive: true })
    rmSync(original, { recursive: true, force: true })

    const reopened = new VaultManager(APP_VERSION)
    const openResult = reopened.open(moved)
    expect(openResult.ok).toBe(true)
    if (!openResult.ok) return

    const afterAttachments = new AttachmentService(openResult.session.db, openResult.session.paths)
    const afterIds = afterAttachments.listFor('person', personId).map((a) => a.id).sort()
    expect(afterIds).toEqual(beforeIds)
    expect(afterAttachments.listFor('person', personId).map((a) => a.originalFilename)).toEqual(beforeNames)

    // Every file resolves and still contains what it did.
    for (const [index, record] of afterAttachments.listFor('person', personId).entries()) {
      const { data } = afterAttachments.read(record.id)
      expect(data.toString('utf8')).toBe(`contents ${index}`)
    }

    const report = reopened.checkIntegrity()
    expect(report.healthy).toBe(true)
    expect(report.attachmentsMissing).toEqual([])
    expect(report.attachmentsOrphaned).toEqual([])
    reopened.close()
  })

  it('stores only vault-relative attachment paths, never absolute ones', () => {
    const manager = new VaultManager(APP_VERSION)
    const root = join(workspace, 'Vault')
    const created = manager.create(root)
    if (!created.ok) throw new Error('setup failed')
    const attachments = new AttachmentService(created.session.db, created.session.paths)
    const personId = seedPerson(manager, 'Someone')
    attachments.addBuffer(new TextEncoder().encode('hello'), 'note.txt', {
      link: { entityType: 'person', entityId: personId }
    })

    const rows = created.session.db.all<{ relative_path: string }>('SELECT relative_path FROM attachments')
    for (const row of rows) {
      expect(row.relative_path.startsWith('attachments/')).toBe(true)
      expect(row.relative_path).not.toContain(workspace)
      expect(row.relative_path.startsWith('/')).toBe(false)
      expect(/^[a-zA-Z]:/.test(row.relative_path)).toBe(false)
    }
    manager.close()
  })

  it('stores identical content once, however it is named', () => {
    const manager = new VaultManager(APP_VERSION)
    const created = manager.create(join(workspace, 'Vault'))
    if (!created.ok) throw new Error('setup failed')
    const attachments = new AttachmentService(created.session.db, created.session.paths)
    const bytes = new TextEncoder().encode('the same receipt')

    const first = attachments.addBuffer(bytes, 'receipt.pdf')
    const second = attachments.addBuffer(bytes, 'a totally different name.pdf')
    expect(second.deduplicated).toBe(true)
    expect(second.attachment.id).toBe(first.attachment.id)
    expect(attachments.count()).toBe(1)
    manager.close()
  })
})

describe('refusing unsafe situations', () => {
  it('refuses a folder that is not a vault', () => {
    const plain = join(workspace, 'just-a-folder')
    mkdirSync(plain)
    const result = new VaultManager(APP_VERSION).open(plain)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('not-a-vault')
  })

  it('reports a missing folder as missing rather than creating one', () => {
    const result = new VaultManager(APP_VERSION).open(join(workspace, 'gone', 'vault'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('path-missing')
      expect(result.error.remedy).toMatch(/removable drive|network share/i)
    }
    expect(existsSync(join(workspace, 'gone'))).toBe(false)
  })

  it('refuses a vault written by a newer Orbit instead of damaging it', () => {
    const manager = new VaultManager(APP_VERSION)
    const root = join(workspace, 'Vault')
    manager.create(root)
    manager.close()

    const manifestPath = join(root, 'orbit-vault.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.schemaVersion = SCHEMA_VERSION + 5
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

    const result = new VaultManager(APP_VERSION).open(root)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('schema-too-new')
      expect(result.error.remedy).toMatch(/Update Orbit/)
      expect(result.error.remedy).toMatch(/Nothing has been changed/)
    }
  })

  it('refuses a corrupt manifest without touching the data', () => {
    const manager = new VaultManager(APP_VERSION)
    const root = join(workspace, 'Vault')
    manager.create(root)
    manager.close()
    writeFileSync(join(root, 'orbit-vault.json'), '{ this is not json')

    const result = new VaultManager(APP_VERSION).open(root)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('manifest-unreadable')
    expect(existsSync(join(root, 'data', 'orbit.sqlite'))).toBe(true)
  })

  it('refuses to open a second time while the first is still open', () => {
    const first = new VaultManager(APP_VERSION)
    const root = join(workspace, 'Vault')
    expect(first.create(root).ok).toBe(true)

    const second = new VaultManager(APP_VERSION)
    const result = second.open(root)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('locked-by-another-instance')

    first.close()
    // Once released, it opens normally.
    const third = new VaultManager(APP_VERSION)
    expect(third.open(root).ok).toBe(true)
    third.close()
  })

  it('lets the user deliberately take over a lock left behind by a crash', () => {
    const first = new VaultManager(APP_VERSION)
    const root = join(workspace, 'Vault')
    expect(first.create(root).ok).toBe(true)

    const second = new VaultManager(APP_VERSION)
    expect(second.open(root).ok).toBe(false)
    // Explicit user consent, and only then.
    const forced = second.open(root, { takeOver: true })
    expect(forced.ok).toBe(true)
    second.close()
    first.close()
  })

  it('rejects an attachment path that tries to escape the vault', () => {
    const manager = new VaultManager(APP_VERSION)
    const created = manager.create(join(workspace, 'Vault'))
    if (!created.ok) throw new Error('setup failed')
    const paths = created.session.paths
    for (const evil of ['../../etc/passwd', '/etc/passwd', 'attachments/../../escape.txt', 'C:\\Windows\\system32']) {
      expect(() => paths.resolveInside(evil)).toThrow(/outside the vault/)
    }
    // And a legitimate one still works.
    expect(paths.resolveInside('attachments/ab/cd/file.pdf')).toContain('Vault')
    manager.close()
  })
})

describe('backup and restore', () => {
  it('takes a consistent backup and restores it exactly', async () => {
    const manager = new VaultManager(APP_VERSION)
    const root = join(workspace, 'Vault')
    const created = manager.create(root)
    if (!created.ok) throw new Error('setup failed')

    seedPerson(manager, 'Original Person')
    const before = created.session.db.all<{ display_name: string }>('SELECT display_name FROM people ORDER BY display_name')

    const backup = await manager.backup({ note: 'before the mistake' })
    expect(backup.bytes).toBeGreaterThan(0)
    expect(existsSync(join(root, 'backups', backup.id, 'orbit.sqlite'))).toBe(true)

    // The mistake.
    seedPerson(manager, 'Accidental Person')
    created.session.db.run('DELETE FROM people WHERE display_name = ?', ['Original Person'])
    expect(manager.require().db.all('SELECT * FROM people')).toHaveLength(1)

    const restored = await manager.restore(backup.id)
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.report.healthy).toBe(true)

    const after = manager.require().db.all<{ display_name: string }>('SELECT display_name FROM people ORDER BY display_name')
    expect(after).toEqual(before)
    manager.close()
  })

  it('takes its own safety backup before restoring, so a wrong restore is recoverable', async () => {
    const manager = new VaultManager(APP_VERSION)
    const created = manager.create(join(workspace, 'Vault'))
    if (!created.ok) throw new Error('setup failed')
    seedPerson(manager, 'A')
    const backup = await manager.backup({ note: 'first' })
    seedPerson(manager, 'B')

    await manager.restore(backup.id)
    const backups = manager.listBackups()
    expect(backups.some((b) => b.reason === 'pre-restore')).toBe(true)
    manager.close()
  })

  it('reports a missing backup rather than destroying the vault', async () => {
    const manager = new VaultManager(APP_VERSION)
    const created = manager.create(join(workspace, 'Vault'))
    if (!created.ok) throw new Error('setup failed')
    seedPerson(manager, 'Still Here')
    const result = await manager.restore('a-backup-that-does-not-exist')
    expect(result.ok).toBe(false)
    expect(manager.require().db.all('SELECT * FROM people')).toHaveLength(1)
    manager.close()
  })
})

describe('integrity and transfer', () => {
  it('detects a missing attachment file', () => {
    const manager = new VaultManager(APP_VERSION)
    const created = manager.create(join(workspace, 'Vault'))
    if (!created.ok) throw new Error('setup failed')
    const attachments = new AttachmentService(created.session.db, created.session.paths)
    const person = seedPerson(manager, 'Someone')
    const { attachment } = attachments.addBuffer(new TextEncoder().encode('data'), 'thing.txt', {
      link: { entityType: 'person', entityId: person }
    })

    expect(manager.checkIntegrity().healthy).toBe(true)
    rmSync(created.session.paths.resolveInside(attachment.relativePath), { force: true })

    const report = manager.checkIntegrity()
    expect(report.healthy).toBe(false)
    expect(report.attachmentsMissing).toHaveLength(1)
    expect(report.attachmentsMissing[0]?.filename).toBe('thing.txt')
    manager.close()
  })

  it('detects a file in the attachments folder that no record claims', () => {
    const manager = new VaultManager(APP_VERSION)
    const created = manager.create(join(workspace, 'Vault'))
    if (!created.ok) throw new Error('setup failed')
    mkdirSync(join(created.session.root, 'attachments', 'zz'), { recursive: true })
    writeFileSync(join(created.session.root, 'attachments', 'zz', 'stray.bin'), 'junk')

    const report = manager.checkIntegrity()
    expect(report.attachmentsOrphaned).toEqual(['attachments/zz/stray.bin'])
    manager.close()
  })

  it('verifies attachment content by hash on demand', async () => {
    const manager = new VaultManager(APP_VERSION)
    const created = manager.create(join(workspace, 'Vault'))
    if (!created.ok) throw new Error('setup failed')
    const attachments = new AttachmentService(created.session.db, created.session.paths)
    const { attachment } = attachments.addBuffer(new TextEncoder().encode('genuine'), 'doc.txt')

    expect((await manager.verifyAttachmentHashes()).mismatched).toHaveLength(0)

    writeFileSync(created.session.paths.resolveInside(attachment.relativePath), 'tampered with')
    const result = await manager.verifyAttachmentHashes()
    expect(result.mismatched).toHaveLength(1)
    manager.close()
  })

  it('flushes the write-ahead log and reports what will not travel', () => {
    const manager = new VaultManager(APP_VERSION)
    const created = manager.create(join(workspace, 'Vault'))
    if (!created.ok) throw new Error('setup failed')
    seedPerson(manager, 'Someone')

    const readiness = manager.prepareForTransfer()
    expect(readiness.ready).toBe(true)
    expect(readiness.walCheckpointed).toBe(true)
    expect(readiness.problems).toEqual([])
    expect(readiness.notes.join(' ')).toMatch(/notification/i)
    expect(readiness.notes.join(' ')).toMatch(/integrations/i)
    expect(readiness.databaseBytes).toBeGreaterThan(0)
    manager.close()
  })

  it('blocks a transfer while attachments are missing', () => {
    const manager = new VaultManager(APP_VERSION)
    const created = manager.create(join(workspace, 'Vault'))
    if (!created.ok) throw new Error('setup failed')
    const attachments = new AttachmentService(created.session.db, created.session.paths)
    const { attachment } = attachments.addBuffer(new TextEncoder().encode('x'), 'f.txt')
    rmSync(created.session.paths.resolveInside(attachment.relativePath), { force: true })

    const readiness = manager.prepareForTransfer()
    expect(readiness.ready).toBe(false)
    expect(readiness.problems.join(' ')).toMatch(/attachment/i)
    manager.close()
  })
})

describe('recovering from an interrupted write', () => {
  it('runs an integrity check automatically after an unclean shutdown', () => {
    const manager = new VaultManager(APP_VERSION)
    const root = join(workspace, 'Vault')
    const created = manager.create(root)
    if (!created.ok) throw new Error('setup failed')
    seedPerson(manager, 'Survivor')

    // Simulate a crash: close the database without the tidy shutdown path,
    // leaving cleanShutdown false and the lock behind.
    created.session.db.close()
    rmSync(join(root, '.orbit-lock'), { force: true })

    const reopened = new VaultManager(APP_VERSION)
    const result = reopened.open(root)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.integrity).not.toBeNull()
    expect(result.integrity?.databaseIntegrity).toBe('ok')
    expect(reopened.require().db.all('SELECT * FROM people')).toHaveLength(1)
    reopened.close()
  })
})
