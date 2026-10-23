import { create } from "zustand";

// 全局轻提示：首页与画布共用。带操作（如「撤销」）时停留更久。

export interface ToastAction { label: string; run: () => void }
export interface ToastMsg { msg: string; key: number; action?: ToastAction; ms: number }

export const useToast = create<{ current: ToastMsg | null }>(() => ({ current: null }));

export function toast(msg: string, action?: ToastAction) {
  useToast.setState({ current: { msg, action, key: Date.now(), ms: action ? 5000 : 1800 } });
}

export const dismissToast = () => useToast.setState({ current: null });
