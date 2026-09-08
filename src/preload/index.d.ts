import type { OrbitApi } from './index.js'

declare global {
  interface Window {
    /** The only privileged surface available to the interface. */
    orbit: OrbitApi
  }
}

export {}
