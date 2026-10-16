
// Painel ADM atualizado: usa o admin.html publicado e troca somente os links
// de Financeiro. Mantem os scripts, autenticacao e API originais.
const bhOriginalFetch = worker_default.fetch.bind(worker_default);
worker_default.fetch = async function(request, env, ctx) {
  const path = new URL(request.url).pathname;
  if (request.method !== "GET" || path !== "/api/admin/painel-atualizado") {
    return bhOriginalFetch(request, env, ctx);
  }
  if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") {
    return new Response("Arquivos do site indisponiveis.", {status:503});
  }
  const asset = await env.ASSETS.fetch(new Request(new URL("/admin.html", request.url)));
  if (!asset.ok) return new Response("Painel administrativo indisponivel.", {status:503});
  const origin = new URL("/",request.url);
  const normalizer = {
    element(element) {
      for(const attr of ["href","src","action"]){
        const value = element.getAttribute(attr);
        if (!value || value.startsWith("#") || value.startsWith("/") || /^[a-z][\w+.-]*:/i.test(value)) continue;
        if (attr === "href" && value.replace(/^\.\//,"").split("?")[0] === "financeiro.html") {
          element.setAttribute(attr, "/api/admin/financeiro-v2");
        } else {
          const target = new URL(value, origin);
          element.setAttribute(attr, target.pathname + target.search + target.hash);
        }
      }
    }
  };
  const body = new Response(asset.body,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
  return new HTMLRewriter().on("a[href],link[href],script[src],img[src],form[action]",normalizer).transform(body);
};
