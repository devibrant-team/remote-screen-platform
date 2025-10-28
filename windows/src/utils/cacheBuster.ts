// src/utils/cacheBuster.ts
let _cb = 0;
export const bumpCacheBuster = () => (++_cb, _cb);
export const getCacheBuster = () => _cb;

// يساعدنا نبني بارامتر cb مع أي params موجودة
export const withCB = (params?: Record<string, any>) => ({
  ...(params ?? {}),
  cb: getCacheBuster(),
});
