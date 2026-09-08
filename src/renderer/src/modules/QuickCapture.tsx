import { useState, type ReactNode } from 'react'
import { call, pathForDroppedFile } from '../lib/api.js'
import { useApp } from '../app/state.js'
import { Icon } from '../components/Icon.js'
import { Modal, Notice } from '../components/ui.js'

/**
 * Quick capture.
 *
 * The point of an in-tray is that putting something into it must be faster
 * than deciding where it goes. Type a line, drop a file, close the box. Orbit
 * files nothing automatically — it makes suggestions in the Inbox, and the
 * user decides there.
 */
export function QuickCapture({ onClose }: { onClose: () => void }): ReactNode {
  const { toast, bumpRevision } = useApp()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [droppedCount, setDroppedCount] = useState(0)

  const submitText = async (): Promise<void> => {
    if (!text.trim()) {
      onClose()
      return
    }
    setBusy(true)
    const result = await call<{ captured: number }>('inbox.capture', {
      kind: 'text',
      title: text.trim().split('\n')[0]?.slice(0, 200) ?? '',
      body: text.trim(),
      source: 'quick-capture'
    })
    setBusy(false)
    if (!result.ok) {
      toast({ tone: 'bad', title: 'That could not be captured', detail: result.error })
      return
    }
    bumpRevision()
    toast({ tone: 'good', title: 'In your inbox', detail: 'Sort it out whenever you like.' })
    onClose()
  }

  const submitFiles = async (paths: string[]): Promise<void> => {
    setBusy(true)
    const result = await call<{ captured: number }>('inbox.capture', { paths, source: 'drag-drop' })
    setBusy(false)
    if (!result.ok) {
      toast({ tone: 'bad', title: 'Those files could not be captured', detail: result.error })
      return
    }
    setDroppedCount((n) => n + result.data.captured)
    bumpRevision()
  }

  return (
    <Modal
      title="Quick capture"
      subtitle="Get it out of your head now. Decide where it belongs later."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {droppedCount > 0 && !text.trim() ? 'Done' : 'Cancel'}
          </button>
          <button className="btn primary" onClick={() => void submitText()} disabled={busy}>
            {busy ? 'Saving…' : 'Add to inbox'}
          </button>
        </>
      }
    >
      <div
        className={`drop-target${dragging ? ' dragging' : ''}`}
        style={{ display: 'grid', gap: 14 }}
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes('Files')) setDragging(true)
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault()
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          const paths = Array.from(event.dataTransfer.files)
            .map((file) => pathForDroppedFile(file))
            .filter(Boolean)
          if (paths.length > 0) void submitFiles(paths)
        }}
      >
        <div className="field">
          <label htmlFor="capture-text">What is it?</label>
          <textarea
            id="capture-text"
            autoFocus
            value={text}
            placeholder={'Ring the garage about the rattle\nRenew the parking permit before the 14th\nRefund from Halton still not here'}
            style={{ minHeight: 120 }}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void submitText()
            }}
          />
          <span className="help">A date or an amount in the text gets picked out as a suggestion in the Inbox.</span>
        </div>

        <Notice tone="info" icon="paperclip" title="Or drop files here">
          Receipts, photographs, PDFs — they go into your inbox with the file attached, ready to be turned into a
          purchase, a document or anything else.
        </Notice>

        {droppedCount > 0 ? (
          <Notice tone="good" title={`${droppedCount} file${droppedCount === 1 ? '' : 's'} captured`}>
            They are waiting in your inbox.
          </Notice>
        ) : null}
      </div>
    </Modal>
  )
}
