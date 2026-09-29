export default {
  fetch(request: Request, env: { ASSETS: Fetcher; PUBLIC_URL: string }): Promise<Response> | Response {
    const url = new URL(request.url);
    const canonical = new URL(env.PUBLIC_URL);
    if (url.origin !== canonical.origin) {
      url.protocol = canonical.protocol;
      url.host = canonical.host;
      return new Response(null, { status: 308, headers: { Location: url.toString() } });
    }
    return env.ASSETS.fetch(request);
  },
};
