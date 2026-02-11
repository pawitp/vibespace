const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders }
  });
}
