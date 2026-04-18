import { useCallback, useEffect, useRef, useState } from 'react'
import { listaApi, type ItemLista, type ListaHojeResponse, type Prioridade, type StatusContato } from '../api/client'

const REFETCH_INTERVAL_MS = 5 * 60 * 1000 // 5 minutos

export function useListaDiaria() {
  const [dados, setDados]     = useState<ListaHojeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [gerando, setGerando] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [filtro, setFiltro]   = useState<Prioridade | 'todos'>('todos')
  const intervaloRef          = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Fetch principal ────────────────────────────────────────────────────
  const buscar = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true)
    setError(null)
    try {
      const data = await listaApi.hoje()
      setDados(data)
    } catch (e) {
      setError('Falha ao carregar a lista. Verifique a conexão com a API.')
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Re-fetch a cada 5 minutos ─────────────────────────────────────────
  useEffect(() => {
    buscar()
    intervaloRef.current = setInterval(() => buscar(true), REFETCH_INTERVAL_MS)
    return () => {
      if (intervaloRef.current) clearInterval(intervaloRef.current)
    }
  }, [buscar])

  // ── Gerar lista (POST) ────────────────────────────────────────────────
  const gerarLista = useCallback(async () => {
    setGerando(true)
    try {
      await listaApi.gerar()
      await buscar(true)
    } catch {
      setError('Falha ao gerar a lista.')
    } finally {
      setGerando(false)
    }
  }, [buscar])

  // ── Atualizar status de contato otimisticamente ───────────────────────
  const atualizarStatus = useCallback(async (id: string, status: StatusContato) => {
    // Atualiza localmente antes de ir ao servidor
    setDados(prev => {
      if (!prev) return prev
      return {
        ...prev,
        itens: prev.itens.map(item =>
          item.id === id ? { ...item, status_contato: status } : item
        ),
      }
    })

    try {
      await listaApi.atualizarContato(id, status)
    } catch {
      // Reverte em caso de erro
      await buscar(true)
    }
  }, [buscar])

  // ── Itens filtrados ───────────────────────────────────────────────────
  const itensFiltrados: ItemLista[] = (dados?.itens ?? []).filter(item =>
    filtro === 'todos' || item.prioridade === filtro
  )

  const pendentes = (dados?.itens ?? []).filter(
    i => i.status_contato === 'pendente'
  ).length

  return {
    dados,
    itens: itensFiltrados,
    loading,
    gerando,
    error,
    filtro,
    setFiltro,
    pendentes,
    atualizarStatus,
    gerarLista,
    refetch: () => buscar(true),
  }
}
