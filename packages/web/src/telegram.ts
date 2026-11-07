/// <reference types="vite/client" />
/**
 * Тонкая типизированная обёртка над официальным SDK Telegram Mini Apps
 * (https://telegram.org/js/telegram-web-app.js подключается в index.html).
 * Все вызовы безопасны вне Telegram и на старых клиентах (проверка версии).
 */

type HapticImpact = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
type HapticNotification = 'error' | 'success' | 'warning';

interface ContactRequestResult {
  status: 'sent' | 'cancelled';
  responseUnsafe?: { contact?: { phone_number?: string; first_name?: string; user_id?: number } };
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name?: string; last_name?: string; username?: string }; start_param?: string };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  isExpanded: boolean;
  ready(): void;
  expand(): void;
  close(): void;
  isVersionAtLeast(version: string): boolean;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  setBottomBarColor?(color: string): void;
  disableVerticalSwipes?(): void;
  onEvent(event: string, cb: (...args: unknown[]) => void): void;
  offEvent(event: string, cb: (...args: unknown[]) => void): void;
  showConfirm(message: string, cb: (ok: boolean) => void): void;
  showAlert(message: string, cb?: () => void): void;
  requestContact?(cb: (sent: boolean, result?: ContactRequestResult) => void): void;
  openTelegramLink(url: string): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback: {
    impactOccurred(style: HapticImpact): void;
    notificationOccurred(type: HapticNotification): void;
    selectionChanged(): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const tg: TelegramWebApp | null = typeof window !== 'undefined' ? (window.Telegram?.WebApp ?? null) : null;

/** true — приложение открыто внутри Telegram. */
export const isTelegram = Boolean(tg?.initData);

const atLeast = (v: string) => Boolean(tg?.isVersionAtLeast?.(v));

/**
 * initData для авторизации на backend. В режиме разработки вне Telegram используется
 * подписанная тестовая initData из VITE_DEV_INIT_DATA (npm run dev:init-data).
 * В production-сборке ветка DEV вырезается.
 */
export function getInitData(): string {
  if (tg?.initData) return tg.initData;
  if (import.meta.env.DEV) return (import.meta.env.VITE_DEV_INIT_DATA as string | undefined) ?? '';
  return '';
}

export type Theme = 'dark' | 'light';

const THEME_COLORS: Record<Theme, string> = { dark: '#000000', light: '#ffffff' };

function currentTheme(): Theme {
  if (tg?.initData) return tg.colorScheme === 'light' ? 'light' : 'dark';
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(): void {
  const theme = currentTheme();
  document.documentElement.dataset.theme = theme;
  const color = THEME_COLORS[theme];
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  if (!tg || !isTelegram) return;
  try {
    if (atLeast('6.1')) {
      // HEX в setHeaderColor поддерживается с Bot API 6.9; раньше — только ключ темы.
      tg.setHeaderColor(atLeast('6.9') ? color : 'bg_color');
      tg.setBackgroundColor(color);
    }
    if (atLeast('7.10')) tg.setBottomBarColor?.(color);
  } catch {
    /* старые клиенты */
  }
}

/** Инициализация Mini App: сообщаем Telegram о готовности, разворачиваем на весь экран, применяем тему. */
export function initTelegram(): void {
  applyTheme();
  if (!tg) return;
  tg.onEvent('themeChanged', applyTheme);
  if (!isTelegram) return;
  tg.ready();
  tg.expand();
  // Чтобы свайп вниз по галерее / списку не сворачивал приложение.
  if (atLeast('7.7')) tg.disableVerticalSwipes?.();
}

export const haptic = {
  impact(style: HapticImpact = 'light') {
    if (isTelegram && atLeast('6.1')) tg!.HapticFeedback.impactOccurred(style);
  },
  notify(type: HapticNotification) {
    if (isTelegram && atLeast('6.1')) tg!.HapticFeedback.notificationOccurred(type);
  },
  selection() {
    if (isTelegram && atLeast('6.1')) tg!.HapticFeedback.selectionChanged();
  },
};

/** Нативный диалог подтверждения Telegram (или браузерный вне Telegram). */
export function confirmDialog(message: string): Promise<boolean> {
  if (isTelegram && atLeast('6.2')) {
    return new Promise((resolve) => tg!.showConfirm(message, (ok) => resolve(Boolean(ok))));
  }
  return Promise.resolve(window.confirm(message));
}

export const canRequestContact = () => isTelegram && atLeast('6.9') && typeof tg?.requestContact === 'function';

/**
 * Запрос номера телефона пользователя через Telegram. Возвращает номер или null (отказ / не поддерживается).
 * Номер используется только как подстановка в поле — пользователь может его изменить.
 */
export function requestPhone(): Promise<string | null> {
  if (!canRequestContact()) return Promise.resolve(null);
  return new Promise((resolve) => {
    tg!.requestContact!((sent, result) => {
      const phone = sent ? result?.responseUnsafe?.contact?.phone_number : undefined;
      resolve(phone ? (phone.startsWith('+') ? phone : `+${phone}`) : null);
    });
  });
}

export function telegramUser() {
  return tg?.initDataUnsafe?.user ?? null;
}

export function openTelegramLink(url: string): void {
  if (isTelegram) tg!.openTelegramLink(url);
  else window.open(url, '_blank', 'noopener');
}
