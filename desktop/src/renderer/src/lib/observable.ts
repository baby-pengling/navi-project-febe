import { useSyncExternalStore } from 'react'

/// Stand-in for SwiftUI's `ObservableObject`: models keep plain fields and call `changed()`
/// after mutating them; `useModel` re-renders the component on every change.
export class Observable {
  private listeners = new Set<() => void>()
  private version = 0

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getVersion = (): number => this.version

  protected changed(): void {
    this.version++
    this.listeners.forEach((listener) => listener())
  }
}

export function useModel<T extends Observable>(model: T): T {
  useSyncExternalStore(model.subscribe, model.getVersion)
  return model
}
