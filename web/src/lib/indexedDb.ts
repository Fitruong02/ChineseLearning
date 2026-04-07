import type { StudyRecord } from '../types'

const DB_NAME = 'hanzi-lens'
const DB_VERSION = 1
const STUDY_STORE = 'study-records'

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result

      if (!database.objectStoreNames.contains(STUDY_STORE)) {
        database.createObjectStore(STUDY_STORE, { keyPath: 'cardId' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Cannot open IndexedDB'))
  })

export const listStudyRecords = async (): Promise<StudyRecord[]> => {
  const database = await openDb()

  return new Promise<StudyRecord[]>((resolve, reject) => {
    const transaction = database.transaction(STUDY_STORE, 'readonly')
    const request = transaction.objectStore(STUDY_STORE).getAll()

    request.onsuccess = () => resolve((request.result as StudyRecord[]) ?? [])
    request.onerror = () => reject(request.error ?? new Error('Cannot read study records'))
    transaction.oncomplete = () => database.close()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Cannot read study records'))
  })
}

export const saveStudyRecord = async (record: StudyRecord): Promise<void> => {
  const database = await openDb()

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STUDY_STORE, 'readwrite')
    const request = transaction.objectStore(STUDY_STORE).put(record)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Cannot save study record'))
    transaction.oncomplete = () => database.close()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Cannot save study record'))
  })
}

export const deleteStudyRecords = async (cardIds: string[]): Promise<void> => {
  if (cardIds.length === 0) {
    return
  }

  const database = await openDb()

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STUDY_STORE, 'readwrite')
    const store = transaction.objectStore(STUDY_STORE)

    cardIds.forEach((cardId) => {
      store.delete(cardId)
    })

    transaction.oncomplete = () => {
      database.close()
      resolve()
    }
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Cannot delete study records'))
  })
}

export const clearStudyRecords = async (): Promise<void> => {
  const database = await openDb()

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STUDY_STORE, 'readwrite')
    const request = transaction.objectStore(STUDY_STORE).clear()

    request.onsuccess = () => resolve()
    request.onerror = () =>
      reject(request.error ?? new Error('Cannot clear study records'))
    transaction.oncomplete = () => database.close()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Cannot clear study records'))
  })
}
