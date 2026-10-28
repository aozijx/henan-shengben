import { createDataContext } from './data.js';
import { loadMetadata } from './metadata.js';
import { createDataRepository } from './data-source.js';

export async function bootstrapData(metadataUrl, fetchImpl) {
  var metadata = await loadMetadata(metadataUrl, fetchImpl);
  var repository = createDataRepository(metadata, fetchImpl);
  var data = createDataContext(repository);
  await data.ensureQueryIndex(metadata.defaultYear);
  return { metadata: metadata, repository: repository, data: data };
}
