export const ORDER_STATUSES = ['new', 'processing', 'completed', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'Новый',
  processing: 'В обработке',
  completed: 'Выполнен',
  cancelled: 'Отменён',
};

export const BROADCAST_STATUSES = ['pending', 'running', 'completed', 'cancelled'] as const;
export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];

export const BROADCAST_STATUS_LABELS: Record<BroadcastStatus, string> = {
  pending: 'В очереди',
  running: 'Отправляется',
  completed: 'Завершена',
  cancelled: 'Остановлена',
};
