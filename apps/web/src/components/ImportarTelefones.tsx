import { useRef, useState } from 'react'
import { importarCsvApi, type PreviewCsv, type ResultadoImportacao } from '../services/api'

type Etapa = 'idle' | 'preview' | 'enviando' | 'processando' | 'resultado'
type Modo  = 'telefones' | 'completo'

function formatarTamanho(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface ResultadoCompleto {
  total_linhas_csv: number
  emails_unicos: number
  criados: number
  atualizados: number
  sem_telefone: number
  erros: number
}

export default function ImportarTelefones() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [modo, setModo]         = useState<Modo>('telefones')
  const [etapa, setEtapa]       = useState<Etapa>('idle')
  const [arquivo, setArquivo]   = useState<File | null>(null)
  const [preview, setPreview]   = useState<PreviewCsv | null>(null)
  const [resultado,    setResultado]    = useState<ResultadoImportacao | null>(null)
  const [resultadoCompleto, setResultadoCompleto] = useState<ResultadoCompleto | null>(null)
  const [erro, setErro]         = useState<string | null>(null)
  const [drag, setDrag]         = useState(false)
  const [uploadPct, setUploadPct] = useState(0)

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
    const extensaoOk = file.name.endsWith('.csv') || file.name.endsWith('.xlsx')
    if (!extensaoOk) {
      setErro('Apenas arquivos .csv ou .xlsx são aceitos.')
      return
    }
    if (file.name.endsWith('.xlsx')) {
      setErro('Arquivos .xlsx detectados: converta para .csv antes de importar. No Excel: Arquivo → Salvar como → CSV UTF-8.')
      return
    }
    setErro(null)
    setArquivo(file)
    setEtapa('preview')

    try {
      const data = await importarCsvApi.preview(file)
      setPreview(data)
    } catch (e: any) {
      const resp = e?.response?.data
      let msg = 'Erro ao ler o arquivo.'
      if (resp?.error)              msg += ` ${resp.error}`
      if (resp?.dica)               msg += ` ${resp.dica}`
      if (resp?.colunas_encontradas?.length) {
        msg += ` Colunas encontradas: ${(resp.colunas_encontradas as string[]).join(', ')}.`
      }
      setErro(msg)
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
    setUploadPct(0)
    setEtapa('enviando')
    try {
      if (modo === 'completo') {
        const data = await importarCsvApi.importarCompleto(arquivo, pct => {
          setUploadPct(pct)
          if (pct === 100) setEtapa('processando')
        })
        setResultadoCompleto(data)
      } else {
        const data = await importarCsvApi.importar(arquivo, pct => {
          setUploadPct(pct)
          if (pct === 100) setEtapa('processando')
        })
        setResultado(data)
      }
      setEtapa('resultado')
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? 'Erro ao importar. Tente novamente.'
      setErro(msg)
      setEtapa('preview')
    }
  }

  function reiniciar() {
    setEtapa('idle')
    setArquivo(null)
    setPreview(null)
    setResultado(null)
    setResultadoCompleto(null)
    setErro(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  function trocarModo(novoModo: Modo) {
    setModo(novoModo)
    reiniciar()
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Seletor de modo */}
      <div className="flex rounded-lg overflow-hidden border border-gray-200 text-sm font-medium">
        <button
          onClick={() => trocarModo('telefones')}
          className={[
            'flex-1 px-4 py-2.5 transition-colors text-center',
            modo === 'telefones'
              ? 'bg-primary-600 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50',
          ].join(' ')}
        >
          Atualizar telefones existentes
        </button>
        <button
          onClick={() => trocarModo('completo')}
          className={[
            'flex-1 px-4 py-2.5 transition-colors text-center border-l border-gray-200',
            modo === 'completo'
              ? 'bg-emerald-600 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50',
          ].join(' ')}
        >
          Importação completa (cria novos + atualiza)
        </button>
      </div>

      {/* Cabeçalho contextual */}
      {modo === 'telefones' ? (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
          <p className="font-medium mb-1">Atualizar telefones de clientes existentes</p>
          <ol className="list-decimal list-inside space-y-0.5 text-blue-700">
            <li>No painel Hotmart: <strong>Vendas → Histórico de Vendas → Exportar CSV</strong></li>
            <li>Faça upload do arquivo exportado abaixo</li>
            <li>O sistema vincula o telefone pelo e-mail do comprador (clientes já cadastrados)</li>
          </ol>
        </div>
      ) : (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-800">
          <p className="font-medium mb-1">Importação completa — cria clientes novos + atualiza existentes</p>
          <ol className="list-decimal list-inside space-y-0.5 text-emerald-700">
            <li>Exporte o CSV completo de vendas da Hotmart (todos os registros)</li>
            <li>Faça upload aqui — o sistema detecta nome, e-mail e telefone</li>
            <li>Clientes que <strong>não existem</strong> no banco serão <strong>criados</strong></li>
            <li>Clientes que <strong>já existem</strong> terão o telefone <strong>atualizado</strong></li>
          </ol>
        </div>
      )}

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
        accept=".csv,.xlsx"
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
                {preview.encoding_detectado && (
                  <span className="ml-2 text-gray-400">
                    · {preview.encoding_detectado}
                    {preview.separador_detectado && ` · sep: "${preview.separador_detectado}"`}
                  </span>
                )}
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

      {/* Enviando */}
      {etapa === 'enviando' && (
        <div className="py-8 space-y-4">
          <p className="text-sm font-medium text-gray-700 text-center">
            Enviando {arquivo ? formatarTamanho(arquivo.size) : 'arquivo'}… {uploadPct}%
          </p>
          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-500 rounded-full transition-all duration-200"
              style={{ width: `${uploadPct}%` }}
            />
          </div>
          <p className="text-xs text-gray-400 text-center">Não feche esta página.</p>
        </div>
      )}

      {/* Processando no servidor */}
      {etapa === 'processando' && (
        <div className="text-center py-10 space-y-3">
          <div className="inline-block w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium text-gray-700">
            Processando {arquivo ? formatarTamanho(arquivo.size) : 'arquivo'}, aguarde…
          </p>
          <p className="text-xs text-gray-400">Arquivos grandes podem levar até 2 minutos.</p>
        </div>
      )}

      {/* Resultado — modo telefones */}
      {etapa === 'resultado' && resultado && modo === 'telefones' && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-800">Resultado da importação</p>
          <div className="space-y-2">
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-xs text-gray-600 space-y-0.5">
              <p>{resultado.total_linhas_csv.toLocaleString('pt-BR')} linhas no CSV · {resultado.emails_unicos_encontrados.toLocaleString('pt-BR')} e-mails únicos</p>
              {resultado.sem_telefone_no_csv > 0 && (
                <p className="text-gray-400">{resultado.sem_telefone_no_csv} e-mails sem telefone no CSV (ignorados)</p>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
              <span className="text-lg">✓</span>
              <span><strong>{resultado.atualizados}</strong> telefones atualizados com sucesso</span>
            </div>
            {resultado.nao_encontrados > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2.5">
                <p className="text-sm text-yellow-800 font-medium">
                  ⚠ {resultado.nao_encontrados} e-mails não encontrados no CRM
                </p>
                <p className="text-xs text-yellow-600 mt-0.5">
                  Use "Importação completa" para criar esses clientes automaticamente.
                </p>
              </div>
            )}
            {resultado.erros > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
                <p className="text-sm text-red-800 font-medium">✗ {resultado.erros} erros ao processar</p>
              </div>
            )}
          </div>
          <button onClick={reiniciar} className="text-sm text-gray-500 hover:text-gray-700 underline">
            Importar outro arquivo
          </button>
        </div>
      )}

      {/* Resultado — modo completo */}
      {etapa === 'resultado' && resultadoCompleto && modo === 'completo' && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-800">Resultado da importação completa</p>
          <div className="space-y-2">
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-xs text-gray-600 space-y-0.5">
              <p>{resultadoCompleto.total_linhas_csv.toLocaleString('pt-BR')} linhas · {resultadoCompleto.emails_unicos.toLocaleString('pt-BR')} e-mails únicos</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-center">
                <p className="text-2xl font-bold text-emerald-700">{resultadoCompleto.criados.toLocaleString('pt-BR')}</p>
                <p className="text-xs text-emerald-600 mt-0.5">clientes criados</p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-center">
                <p className="text-2xl font-bold text-blue-700">{resultadoCompleto.atualizados.toLocaleString('pt-BR')}</p>
                <p className="text-xs text-blue-600 mt-0.5">telefones atualizados</p>
              </div>
            </div>
            {resultadoCompleto.sem_telefone > 0 && (
              <p className="text-xs text-gray-400 text-center">
                {resultadoCompleto.sem_telefone.toLocaleString('pt-BR')} clientes sem telefone no CSV (criados sem telefone)
              </p>
            )}
            {resultadoCompleto.erros > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
                <p className="text-sm text-red-800 font-medium">✗ {resultadoCompleto.erros} erros ao processar</p>
              </div>
            )}
          </div>
          <button onClick={reiniciar} className="text-sm text-gray-500 hover:text-gray-700 underline">
            Importar outro arquivo
          </button>
        </div>
      )}
    </div>
  )
}
