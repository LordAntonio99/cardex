import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import './styles/index.css'

/**
 * La base de datos está en la misma máquina: una consulta tarda menos de un
 * milisegundo. Lo que se aprovecha de TanStack Query no es la caché de red sino
 * el grafo de invalidación y los estados de carga y error, así que los tiempos
 * de refresco se dejan largos y la invalidación la dispara el evento
 * `db:changed` que manda el proceso main.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1
    }
  }
})

const container = document.getElementById('root')
if (!container) throw new Error('Falta el contenedor #root')

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
)
