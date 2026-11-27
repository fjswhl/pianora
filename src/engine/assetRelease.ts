// Keep existing object keys immutable. Future releases get new keys and ETags.
export const pianoFlowRelease = {
  model: {
    path: '/models/pianoflow_step_fp32.onnx',
    revision: '793f955f4452349f34144143bcbe1e09',
  },
  tokenizer: () => import('../../public/models/pianoflow_tokenizer_meta.json'),
};
export const soundfonts = {
  abbey: {
    path: '/soundfonts/abbey_steinway_d.sf2',
    revision: 'bc90fc633e520e067896c3c7ffba65f9',
  },
  nice: {
    path: '/soundfonts/nice_steinway_v38.sf2',
    revision: 'c78ef20cffdc7f1e27226a6a7a7c1b43',
  },
  fazioli: {
    path: '/soundfonts/fazioli_f308.sf2',
    revision: '1ed0ce9e5079536f6ff556174dab0973',
  },
};

export function releaseUrl(asset: { path: string; revision: string }): string {
  const origin = import.meta.env.VITE_R2_PUBLIC_ORIGIN || location.origin;
  const url = new URL(asset.path, origin);
  url.searchParams.set('rev', asset.revision);
  return url.href;
}
