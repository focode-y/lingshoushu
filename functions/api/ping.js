export async function onRequestGet() {
    return new Response(JSON.stringify({ ok: true, source: "pages-functions" }), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
