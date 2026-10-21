import { buildIndexes, loadAll } from './data.js';
import { loadMetadata } from './metadata.js';

export async function bootstrapData(metadataUrl, fetchImpl) {
  var metadata = await loadMetadata(metadataUrl, fetchImpl);
  var store = await loadAll(metadata, fetchImpl);
  var index = buildIndexes(store, metadata);
  return { metadata: metadata, store: store, index: index };
}
