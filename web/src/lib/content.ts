import type { ContentLibrary, ContentManifest, DraftDeck, MaterialSource, PublishedDeck } from '../types'

const assetPath = (relativePath: string) =>
  `${import.meta.env.BASE_URL}${relativePath.replace(/^\/+/, '')}`

const fetchJson = async <T>(relativePath: string): Promise<T> => {
  const response = await fetch(assetPath(relativePath), {
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Unable to load ${relativePath}: ${response.status}`)
  }

  return (await response.json()) as T
}

export const loadContentLibrary = async (): Promise<ContentLibrary> => {
  const manifest = await fetchJson<ContentManifest>('content/manifest.json')
  const [manifestMaterials, manifestPublishedDecks, draftDecks] = await Promise.all([
    Promise.all(
      manifest.materials.map((relativePath) =>
        fetchJson<MaterialSource>(relativePath),
      ),
    ),
    Promise.all(
      manifest.publishedDecks.map((relativePath) =>
        fetchJson<PublishedDeck>(relativePath),
      ),
    ),
    Promise.all(
      manifest.draftDecks.map((relativePath) => fetchJson<DraftDeck>(relativePath)),
    ),
  ])

  const materials = [...manifestMaterials]
  const publishedDecks = [...manifestPublishedDecks]

  return {
    manifest,
    materials: materials.sort((left, right) =>
      right.importedAt.localeCompare(left.importedAt),
    ),
    publishedDecks: publishedDecks.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    ),
    draftDecks: draftDecks.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    ),
  }
}
