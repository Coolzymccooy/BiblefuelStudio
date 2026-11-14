/** Normalize provider receipts conservatively; accepted is NOT confirmed public. */
export function createFiniteDispatcher(dispatchPost, publicBaseUrl) {
  return async (payload, req) => {
    const base = String(publicBaseUrl() || '').replace(/\/+$/, '');
    if (payload.destination === 'tiktok' && !/^https:\/\//i.test(base)) throw new Error('Public HTTPS base URL is required for TikTok');
    let result;
    try { result = await dispatchPost(payload, { ...req, finiteOneOff: true,
      protocol: 'https', headers: {}, get: () => base.replace(/^https?:\/\//, '') }); }
    catch (e) {
      const youtubeRejected = payload.destination === 'youtube' && [400, 401, 403, 404, 422].includes(e?.response?.status);
      if (e?.finiteProviderRejected === true || youtubeRejected) return { status: 'failed', error: 'Provider explicitly rejected the post.', receipt: { provider: payload.destination, providerStatus: 'rejected' } };
      throw e;
    }
    if (payload.destination === 'youtube') {
      const data = result?.data;
      const uploadStatus = data?.status?.uploadStatus;
      const rejected = ['failed', 'rejected', 'deleted'].includes(uploadStatus) || Boolean(data?.error || result?.error);
      const confirmed = Boolean(result?.videoId && uploadStatus === 'processed' && data?.status?.privacyStatus === 'public' && !result?.forcedPrivate && !rejected);
      return { status: rejected ? 'failed' : confirmed ? 'published' : result?.videoId ? 'accepted' : 'needs_review',
        error: rejected ? 'YouTube explicitly failed or rejected the upload.' : null,
        receipt: { provider: 'youtube', videoId: result?.videoId || null, url: result?.videoUrl || null,
          requestedPrivacy: 'public', reportedPrivacy: data?.status?.privacyStatus || null, uploadStatus: data?.status?.uploadStatus || null } };
    }
    const z = result?.zernio, post = z?.data?.post;
    const platform = post?.platforms?.find(p => p.platform === 'tiktok');
    const draft = z?.deliveredAsDraft === true;
    const reportedPrivacy = platform?.platformSpecificData?.privacy_level || null;
    const confirmed = !draft && platform?.status === 'published' && reportedPrivacy === 'PUBLIC_TO_EVERYONE';
    const rejected = ['failed', 'rejected'].includes(platform?.status || post?.status);
    return { status: rejected ? 'failed' : draft ? 'draft' : confirmed ? 'published' : z?.postId ? 'accepted' : 'needs_review',
      error: rejected ? 'TikTok explicitly failed or rejected the post.' : null,
      receipt: { provider: 'zernio-tiktok', postId: z?.postId || null, providerStatus: platform?.status || post?.status || null,
        requestedPrivacy: 'PUBLIC_TO_EVERYONE', reportedPrivacy, draft } };
  };
}
