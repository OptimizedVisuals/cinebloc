import { useState, type DragEvent } from 'react'
import { getServices } from '@/state/services'
import { useAppStore } from '@/state/store'

export interface DropAssetHandlers {
  isDragging: boolean
  onDragOver: (e: DragEvent) => void
  onDragLeave: (e: DragEvent) => void
  onDrop: (e: DragEvent) => void
  /** Direct ingestion for click-to-browse pickers (no drag required). */
  onFiles: (files: FileList | File[] | null | undefined) => Promise<void>
}

/**
 * Media binding pipeline (claim 2): an image dropped on a shot is stored
 * as a raw binary blob in IndexedDB, then linked via shot.asset_refs.
 */
export function useDropAsset(shotId: string): DropAssetHandlers {
  const [isDragging, setIsDragging] = useState(false)

  async function ingest(files: FileList | File[] | null | undefined): Promise<void> {
    const store = useAppStore.getState()
    if (!files || files.length === 0) return
    const file = files[0]
    if (!file.type.startsWith('image/')) {
      store.pushToast('Only image files can be attached to a shot.', 'error')
      return
    }
    const key = `${shotId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, '_')}`
    try {
      await getServices().storage.putBlob(key, file)
      store.addAssetRef(shotId, key)
      store.pushToast(`Attached ${file.name} (saved on this device).`, 'ok')
    } catch (cause) {
      console.error('blob save failed', cause)
      store.pushToast('Could not save the image to local storage.', 'error')
    }
  }

  return {
    isDragging,
    onDragOver(e) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setIsDragging(true)
    },
    onDragLeave(e) {
      e.preventDefault()
      setIsDragging(false)
    },
    onDrop(e) {
      e.preventDefault()
      setIsDragging(false)
      void ingest(e.dataTransfer.files)
    },
    onFiles: ingest,
  }
}
