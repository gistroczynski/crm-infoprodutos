import { useRef, useState } from 'react'
import { importarCsvApi, type PreviewCsv, type ResultadoImportacao } from '../services/api'

type Etapa = 'idle' | 'preview' | 'importando' | 'resultado'

export default function ImportarTelefones() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [etapa, setEtapa] = useState<Etapa>('idle')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewCsv | null>(null)
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)

  // ── Download do modelo ─────────────────────────────────────────────────
  async function baixarModelo() {
    const blob = await importarCsvApi.template()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'modelo-telefones.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Selecionar arquivo ─────────────────────────────────────────────────
  async function processarArquivo(file: File) {
    if (!file.name.endsWith('.csv')) {
      setErro('Apenas arquivos .csv são aceitos.')
      return
    }
    setErro(null)
    setArquivo(file)
    setEtapa('preview')

    try {
      const data = await importarCsvApi.preview(file)
      setPreview(data)
    } catch (e) {
      setErro('Erro ao ler o arquivo. Verifique se é um CSV válido.')
      setEtapa('idle')
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processarArquivo(file)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDrag(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processarArquivo(file)
  }

  // ── Confirmar importação ───────────────────────────────────────────────
  async function confirmar() {
    if (!arquivo) return
    setEtapa('importando')
    try {
      const data = await importarCsvApi.importar(arquivo)
      setResultado(data)
      setEtapa('resultado')
    } catch (e) {
      setErro('Erro ao importar. Tente novamente.')
      setEtapa('preview')
    }
  }

  function reiniciar() {
    setEtapa('idle')
    setArquivo(null)
    setPreview(null)
    setResultado(null)
    setErro(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Cabeçalho */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <p className="font-medium mb-1">Como importar telefones da Hotmart</p>
        <ol className="list-decimal list-inside space-y-0.5 text-blue-700">
          <li>No painel Hotmart: <strong>Vendas → Histórico de Vendas → Exportar CSV</strong></li>
          <li>Faça upload do arquivo exportado abaixo</li>
          <li>O sistema vincula o telefone pelo e-mail do comprador</li>
        </ol>
      </div>

      {/* Botão modelo + input oculto */}
      <div className="flex items-center gap-3">
        <button
          onClick={baixarModelo}
          className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Baixar modelo CSV
        </button>
        <span className="text-xs text-gray-400">
          Use este modelo se for montar o arquivo manualmente
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={onInputChange}
      />

      {/* Área de upload */}
      {etapa === 'idle' && (
        <div
          onDragOver={e => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={[
            'border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors',
            drag
              ? 'border-blue-400 bg-blue-50'
              : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50',
          ].join(' ')}
        >
          <div className="text-4xl mb-3">📂</div>
          <p className="text-sm font-medium text-gray-700">
            Arraste o CSV aqui ou clique para selecionar
          </p>
          <p className="text-xs text-gray-400 mt-1">Somente arquivos .csv</p>
        </div>
      )}

      {/* Erro */}
      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {erro}
        </div>
      )}

      {/* Preview */}
      {etapa === 'preview' && preview && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-800">
                Arquivo: <span className="text-gray-600">{arquivo?.name}</span>
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {preview.total_linhas} linhas detectadas
              </p>
            </div>
            <button onClick={reiniciar} className="text-xs text-gray-400 hover:text-gray-600">
              Trocar arquivo
            </button>
          </div>

          {/* Colunas detectadas */}
          <div className="flex gap-4 text-xs">
            <span className={`px-2 py-1 rounded-full font-medium ${
              preview.colunas_detectadas.email
                ? 'bg-green-100 text-green-700'
                : 'bg-red-100 text-red-700'
            }`}>
              {preview.colunas_detectadas.email
                ? `✓ E-mail: "${preview.colunas_detectadas.email}"`
                : '✗ Coluna de e-mail não encontrada'}
            </span>
            <span className={`px-2 py-1 rounded-full font-medium ${
              preview.colunas_detectadas.telefone
                ? 'bg-green-100 text-green-700'
                : 'bg-red-100 text-red-700'
            }`}>
              {preview.colunas_detectadas.telefone
                ? `✓ Telefone: "${preview.colunas_detectadas.telefone}"`
                : '✗ Coluna de telefone não encontrada'}
            </span>
          </div>

          {/* Tabela de preview */}
          {preview.preview.length > 0 && (
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    {preview.cabecalhos.slice(0, 6).map(h => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.preview.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      {preview.cabecalhos.slice(0, 6).map(h => (
                        <td key={h} className="px-3 py-2 text-gray-700 max-w-[200px] truncate">
                          {row[h] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.total_linhas > 5 && (
                <p className="text-xs text-gray-400 text-center py-2">
                  Mostrando 5 de {preview.total_linhas} linhas
                </p>
              )}
            </div>
          )}

          {/* Botão confirmar */}
          {preview.colunas_detectadas.email && preview.colunas_detectadas.telefone ? (
            <button
              onClick={confirmar}
              className="w-full py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
            >
              Confirmar importação de {preview.total_linhas} registros
            </button>
          ) : (
            <p className="text-sm text-red-600 text-center">
              Corrija as colunas ausentes antes de importar.
            </p>
          )}
        </div>
      )}

      {/* Importando */}
      {etapa === 'importando' && (
        <div className="text-center py-10">
          <div className="inline-block w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-gray-600">Importando telefones...</p>
        </div>
      )}

      {/* Resultado */}
      {etapa === 'resultado' && resultado && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-800">Resultado da importação</p>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
              <span className="text-lg">✓</span>
              <span><strong>{resultado.atualizados}</strong> telefones atualizados com sucesso</span>
            </div>

            {resultado.nao_encontrados.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2.5">
                <p className="text-sm text-yellow-800 font-medium mb-1">
                  ⚠ {resultado.nao_encontrados.length} e-mails não encontrados no CRM
                </p>
                <div className="max-h-28 overflow-y-auto">
                  {resultado.nao_encontrados.map(email => (
                    <p key={email} className="text-xs text-yellow-700 font-mono">{email}</p>
                  ))}
                </div>
              </div>
            )}

            {resultado.erros.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
                <p className="text-sm text-red-800 font-medium mb-1">
                  ✗ {resultado.erros.length} erros
                </p>
                <div className="max-h-28 overflow-y-auto">
                  {resultado.erros.map((e, i) => (
                    <p key={i} className="text-xs text-red-700 font-mono">{e}</p>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={reiniciar}
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Importar outro arquivo
          </button>
        </div>
      )}
    </div>
  )
}
