export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/token") {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }
      const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
        method: "POST",
        headers: {
          Authorization: "Token " + env.DEEPGRAM_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl_seconds: 300 }),
      });
      return new Response(await res.text(), {
        status: res.status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
