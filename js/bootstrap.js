import { buildIndexes, loadAll } from './data.js';
import { loadMetadata } from './metadata.js';
import { createDataRepository } from './data-source.js';

export async function bootstrapData(metadataUrl, fetchImpl) {
  var metadata = await loadMetadata(metadataUrl, fetchImpl);
  var repository = createDataRepository(metadata, fetchImpl);
  var store = await loadAll(metadata, fetchImpl, repository);
  var index = buildIndexes(store, metadata);
  return { metadata: metadata, store: store, index: index, repository: repository };
}
