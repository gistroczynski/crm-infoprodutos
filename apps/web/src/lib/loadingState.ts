// Módulo singleton para rastrear requisições em andamento.
// Ambas as instâncias axios (api/client.ts e services/api.ts) escrevem aqui.
// O componente LoadingBar lê via onLoadingChange().

type Listener = (loading: boolean) => void
const listeners = new Set<Listener>()
let count = 0

function notify() {
  const loading = count > 0
  listeners.forEach(fn => fn(loading))
}

/** Registra um listener e retorna a função de remoção. */
export function onLoadingChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function incrementLoading() {
  count++
  notify()
}

export function decrementLoading() {
  count = Math.max(0, count - 1)
  notify()
}
