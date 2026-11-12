import { create } from 'zustand';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'success';
}

interface ToastStore {
  toasts: Toast[];
  push: (text: string, tone?: Toast['tone']) => void;
  remove: (id: number) => void;
}

let nextId = 1;
export const useToasts = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (text, tone = 'info') => {
    const id = nextId++;
    set({ toasts: [...get().toasts.filter((t) => t.text !== text), { id, text, tone }].slice(-4) });
    setTimeout(() => get().remove(id), 3200);
  },
  remove: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (text: string, tone?: Toast['tone']) => useToasts.getState().push(text, tone);
