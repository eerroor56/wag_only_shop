import { formatPhone, formatPrice } from '@wag/shared';
import type { AppConfig } from '../config.js';
import { escapeHtml, formatDateTime } from '../lib/format.js';

export function welcomeText(config: AppConfig): string {
  return [
    `<b>${escapeHtml(config.shop.name)}</b>`,
    escapeHtml(config.shop.description),
    '',
    'Откройте каталог, выберите вещи и оформите заказ.',
    `Менеджер @${escapeHtml(config.shop.managerUsername)} свяжется с вами для подтверждения.`,
  ].join('\n');
}

export interface OrderMessageData {
  id: number;
  customerName: string;
  phone: string;
  telegramId: number;
  telegramUsername: string | null;
  totalAmount: number;
  createdAt: Date;
  items: { title: string; size: string | null; price: number; quantity: number; total: number }[];
}

/** Сообщение владельцу о новом заказе (parse_mode = HTML, все пользовательские данные экранированы). */
export function newOrderMessage(o: OrderMessageData, timeZone: string): string {
  const lines: string[] = [
    '🛍 <b>Новый заказ</b>',
    '',
    `<b>Заказ №${o.id}</b>`,
    `<i>${escapeHtml(formatDateTime(o.createdAt, timeZone))}</i>`,
    '',
    '<b>Клиент:</b>',
    escapeHtml(o.customerName),
    '',
    '<b>Телефон:</b>',
    escapeHtml(formatPhone(o.phone)),
    '',
    '<b>Telegram:</b>',
    o.telegramUsername
      ? `@${escapeHtml(o.telegramUsername)}`
      : `<a href="tg://user?id=${o.telegramId}">Профиль клиента</a>\nTelegram ID: <code>${o.telegramId}</code>`,
    '',
    '<b>Товары:</b>',
  ];
  o.items.forEach((item, idx) => {
    lines.push('');
    lines.push(`${idx + 1}. ${escapeHtml(item.title)}${item.size ? ` · размер <b>${escapeHtml(item.size)}</b>` : ''}`);
    lines.push(`    ${item.quantity} × ${escapeHtml(formatPrice(item.price))} = ${escapeHtml(formatPrice(item.total))}`);
  });
  lines.push('', `<b>Итого: ${escapeHtml(formatPrice(o.totalAmount))}</b>`);
  return lines.join('\n');
}
