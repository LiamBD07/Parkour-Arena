export function configureAppOrigin(env: Record<string, string | undefined>) {
  const origin = (env.APP_ORIGIN || env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(
    /\/$/,
    '',
  );
  if (env.NODE_ENV === 'production') {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin) {
      throw new Error(
        'Production needs an HTTPS APP_ORIGIN or Render-provided RENDER_EXTERNAL_URL.',
      );
    }
  }
  env.APP_ORIGIN = origin;
  return origin;
}
