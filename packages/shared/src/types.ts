import type { BroadcastStatus, OrderStatus } from './order-status.js';
import type { FieldIssue, ProductAttribute } from './schemas.js';

/** Даты передаются строками ISO 8601, деньги — целыми копейками. */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: FieldIssue[] };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface PublicConfigDTO {
  shopName: string;
  shopDescription: string;
  managerUsername: string;
  botUsername: string | null;
}

export interface MeDTO {
  id: number;
  telegramId: number;
  firstName: string;
  username: string | null;
  isAdmin: boolean;
}

export interface ImageDTO {
  id: number;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
}

export interface ProductCardDTO {
  id: number;
  title: string;
  price: number;
  oldPrice: number | null;
  /** Процент скидки для отображения (ручной или вычисленный), null — без скидки. */
  discountPercent: number | null;
  image: ImageDTO | null;
}

export interface ProductDetailDTO extends ProductCardDTO {
  description: string;
  attributes: ProductAttribute[];
  /** Галерея: главное фото первым, далее в порядке администратора. */
  images: ImageDTO[];
}

export interface ProductsPageDTO {
  items: ProductCardDTO[];
  total: number;
  nextOffset: number | null;
}

export interface CartItemDTO {
  id: number;
  productId: number;
  quantity: number;
  /** false — товар скрыт, оформить его нельзя. */
  available: boolean;
  lineTotal: number;
  product: ProductCardDTO;
}

export interface CartDTO {
  items: CartItemDTO[];
  totalQuantity: number;
  /** Сумма только доступных позиций, рассчитана сервером. */
  totalAmount: number;
  hasUnavailable: boolean;
}

export interface OrderItemDTO {
  id: number;
  productId: number | null;
  title: string;
  price: number;
  quantity: number;
  total: number;
}

export interface OrderDTO {
  id: number;
  status: OrderStatus;
  customerName: string;
  phone: string;
  totalAmount: number;
  itemsCount: number;
  createdAt: string;
  items: OrderItemDTO[];
}

export interface AdminOrderDTO extends OrderDTO {
  updatedAt: string;
  telegramUsername: string | null;
  user: { id: number; telegramId: number; username: string | null; firstName: string; lastName: string | null };
}

export interface AdminImageDTO extends ImageDTO {
  isMain: boolean;
}

export interface AdminProductDTO {
  id: number;
  title: string;
  description: string;
  price: number;
  oldPrice: number | null;
  /** Значение, введённое администратором (может быть null). */
  discountPercent: number | null;
  /** Что увидит покупатель. */
  effectiveDiscountPercent: number | null;
  attributes: ProductAttribute[];
  isActive: boolean;
  sortOrder: number;
  images: AdminImageDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface AdminProductsDTO {
  items: AdminProductDTO[];
  counts: { total: number; active: number; hidden: number };
}

export interface AdminUserDTO {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string;
  lastName: string | null;
  isBlocked: boolean;
  ordersCount: number;
  createdAt: string;
  lastSeenAt: string;
}

export interface DashboardDTO {
  productsTotal: number;
  productsActive: number;
  ordersNew: number;
  usersTotal: number;
  ordersToday: number;
  /** Сумма заказов за сегодня без отменённых. */
  revenueToday: number;
  timezone: string;
}

export interface BroadcastDTO {
  id: number;
  text: string;
  withShopButton: boolean;
  status: BroadcastStatus;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
