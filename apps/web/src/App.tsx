import { Routes, Route, Navigate } from 'react-router-dom'
import { ToastProvider } from './components/Toast'
import LoadingBar from './components/LoadingBar'
import Layout from './components/layout/Layout'
import ListaDiaria from './pages/ListaDiaria'
import Clientes from './pages/Clientes'
import Cliente from './pages/Cliente'
import Dashboard from './pages/Dashboard'
import Relatorios from './pages/Relatorios'
import Configuracoes from './pages/Configuracoes'
import Vendas from './pages/Vendas'
import Cadencias from './pages/Cadencias'
import FluxoAtivo from './pages/FluxoAtivo'
import Reativacao from './pages/Reativacao'
import Erro404 from './pages/Erro404'

export default function App() {
  return (
    <ToastProvider>
      <LoadingBar />
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/lista-diaria" replace />} />
          <Route path="lista-diaria" element={<ListaDiaria />} />
          <Route path="clientes" element={<Clientes />} />
          <Route path="clientes/:id" element={<Cliente />} />
          <Route path="vendas" element={<Vendas />} />
          <Route path="cadencias" element={<Cadencias />} />
          <Route path="fluxo-ativo" element={<FluxoAtivo />} />
          <Route path="reativacao" element={<Reativacao />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="relatorios" element={<Relatorios />} />
          <Route path="configuracoes" element={<Configuracoes />} />
          <Route path="*" element={<Erro404 />} />
        </Route>
      </Routes>
    </ToastProvider>
  )
}
