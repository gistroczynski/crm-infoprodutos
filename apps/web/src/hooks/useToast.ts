import { useToastContext } from '../components/Toast'

export function useToast() {
  const { addToast } = useToastContext()
  return {
    success: (message: string) => addToast('success', message),
    error:   (message: string) => addToast('error',   message),
    warning: (message: string) => addToast('warning', message),
    info:    (message: string) => addToast('info',    message),
  }
}
