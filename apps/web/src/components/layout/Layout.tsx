import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import { useDarkMode } from '../../hooks/useDarkMode'

export default function Layout() {
  useDarkMode()
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
