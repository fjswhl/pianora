import assets from './assetSources.json';

// Keep existing object keys immutable. Future releases get new keys and ETags.
export const pianoFlowRelease = {
  model: assets.model,
  tokenizer: () => import('../../public/models/pianoflow_tokenizer_meta.json'),
};
export const soundfonts = { abbey: assets.abbey, nice: assets.nice, fazioli: assets.fazioli };

export function releaseUrl(asset: { path: string; revision: string }): string {
  const origin = import.meta.env.VITE_R2_PUBLIC_ORIGIN || location.origin;
  const url = new URL(asset.path, origin);
  url.searchParams.set('rev', asset.revision);
  return url.href;
}
