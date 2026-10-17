/** Accept resource/project endpoints and the full Responses URL shown by Azure. */
export function normalizeAzureEndpoint(value: string) {
  const endpoint = value.trim()
  let url: URL
  try { url = new URL(endpoint) } catch { throw new Error("El endpoint de Azure no es una URL válida.") }
  if (url.protocol !== "https:" || !/\.(?:openai\.azure\.com|services\.ai\.azure\.com|cognitiveservices\.azure\.com)$/.test(url.hostname)
    || url.username || url.password || url.search || url.hash || (url.port && url.port !== "443")) {
    throw new Error("Usá el endpoint HTTPS oficial de Azure, sin claves ni parámetros en la URL.")
  }
  const path = url.pathname.replace(/\/+$/, "")
  const basePath = path.replace(/(\/openai\/v1)\/responses$/, "$1")
  if (basePath && !/^\/openai(?:\/v1)?$/.test(basePath) && !/^\/api\/projects\/[^/]+(?:\/openai(?:\/v1)?)?$/.test(basePath)) {
    throw new Error("Copiá el endpoint del recurso o proyecto Azure, o su URL completa de Responses.")
  }
  if (basePath === path) return endpoint
  url.pathname = basePath
  return url.toString()
}
