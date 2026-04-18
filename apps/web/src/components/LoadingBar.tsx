import { useEffect, useState } from 'react'
import { onLoadingChange } from '../lib/loadingState'

/**
 * Barra de progresso de 2px no topo da tela.
 * Aparece quando há requisições axios em andamento.
 */
export default function LoadingBar() {
  const [visible, setVisible] = useState(false)
  const [width,   setWidth]   = useState(0)

  useEffect(() => {
    return onLoadingChange(loading => {
      if (loading) {
        setVisible(true)
        setWidth(0)
        // Duplo rAF para garantir que o browser renderize width=0 antes de transicionar
        requestAnimationFrame(() => {
          requestAnimationFrame(() => setWidth(75))
        })
      } else {
        setWidth(100)
        setTimeout(() => {
          setVisible(false)
          setWidth(0)
        }, 350)
      }
    })
  }, [])

  if (!visible) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-0.5 bg-gray-100">
      <div
        className="h-full bg-primary-500"
        style={{
          width: `${width}%`,
          transition: `width ${width === 100 ? '200ms' : '1500ms'} ease-out`,
        }}
      />
    </div>
  )
}
