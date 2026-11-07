import { z } from 'zod';
import { LIMITS } from './constants.js';
import { ORDER_STATUSES } from './order-status.js';
import { normalizePhone } from './phone.js';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const cleanText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Максимум ${max} символов`)
    .refine((v) => !CONTROL_CHARS.test(v), 'Недопустимые символы');

const id = z.coerce.number().int().positive();
export const idParamSchema = z.object({ id });

const kopecks = z.number().int('Цена должна быть целым числом копеек').min(0, 'Цена не может быть отрицательной').max(LIMITS.priceMax);

// ---------- Корзина ----------

export const cartAddSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(LIMITS.cartItemMaxQuantity).default(1),
});
export type CartAddInput = z.infer<typeof cartAddSchema>;

export const cartUpdateSchema = z.object({
  quantity: z.number().int().min(1).max(LIMITS.cartItemMaxQuantity),
});
export type CartUpdateInput = z.infer<typeof cartUpdateSchema>;

// ---------- Оформление заказа ----------

export const checkoutSchema = z.object({
  customerName: cleanText(LIMITS.customerNameMax).pipe(z.string().min(1, 'Введите имя')),
  phone: z
    .string()
    .trim()
    .min(1, 'Введите номер телефона')
    .max(32, 'Некорректный номер телефона')
    .refine((v) => normalizePhone(v) !== null, 'Некорректный номер телефона'),
  /** Сумма, которую видел пользователь. Используется ТОЛЬКО для сравнения: сервер всегда считает сам. */
  expectedTotal: z.number().int().min(0).optional(),
  /** Защита от двойного нажатия «Оформить заказ». */
  idempotencyKey: z.uuid(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

// ---------- Товары (админ) ----------

export const productAttributeSchema = z.object({
  name: cleanText(LIMITS.productAttributeNameMax).pipe(z.string().min(1, 'Укажите название характеристики')),
  value: cleanText(LIMITS.productAttributeValueMax).pipe(z.string().min(1, 'Укажите значение характеристики')),
});
export type ProductAttribute = z.infer<typeof productAttributeSchema>;

export const productFieldsSchema = z.object({
  title: cleanText(LIMITS.productTitleMax).pipe(z.string().min(1, 'Введите название')),
  description: z
    .string()
    .trim()
    .max(LIMITS.productDescriptionMax, `Максимум ${LIMITS.productDescriptionMax} символов`)
    .default(''),
  price: kopecks,
  oldPrice: kopecks.nullable().default(null),
  discountPercent: z.number().int().min(1, 'Скидка от 1 до 99%').max(99, 'Скидка от 1 до 99%').nullable().default(null),
  attributes: z.array(productAttributeSchema).max(LIMITS.productAttributesMax).default([]),
  isActive: z.boolean().default(true),
  /** Упорядоченный список загруженных изображений. */
  imageIds: z
    .array(z.number().int().positive())
    .max(LIMITS.productImagesMax, `Максимум ${LIMITS.productImagesMax} фото`)
    .default([]),
  mainImageId: z.number().int().positive().nullable().default(null),
});

export type ProductFields = z.infer<typeof productFieldsSchema>;

export interface FieldIssue {
  path: string;
  message: string;
}

/** Перекрёстные правила товара. Вызываются после слияния PATCH с текущими данными. */
export function productRuleIssues(p: ProductFields): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (p.oldPrice != null && p.oldPrice <= p.price) {
    issues.push({ path: 'oldPrice', message: 'Старая цена должна быть больше цены со скидкой' });
  }
  if (p.discountPercent != null && p.oldPrice == null) {
    issues.push({ path: 'discountPercent', message: 'Для скидки укажите старую цену' });
  }
  if (new Set(p.imageIds).size !== p.imageIds.length) {
    issues.push({ path: 'imageIds', message: 'Фотографии повторяются' });
  }
  if (p.mainImageId != null && !p.imageIds.includes(p.mainImageId)) {
    issues.push({ path: 'mainImageId', message: 'Главное фото должно быть среди фотографий товара' });
  }
  return issues;
}

export const productCreateSchema = productFieldsSchema.superRefine((p, ctx) => {
  for (const i of productRuleIssues(p)) ctx.addIssue({ code: 'custom', path: [i.path], message: i.message });
});

/** PATCH: любые поля. Перекрёстные правила проверяются сервером после слияния с текущим товаром. */
export const productPatchSchema = z.object({
  title: productFieldsSchema.shape.title.optional(),
  description: z.string().trim().max(LIMITS.productDescriptionMax).optional(),
  price: kopecks.optional(),
  oldPrice: kopecks.nullable().optional(),
  discountPercent: z.number().int().min(1).max(99).nullable().optional(),
  attributes: z.array(productAttributeSchema).max(LIMITS.productAttributesMax).optional(),
  isActive: z.boolean().optional(),
  imageIds: z.array(z.number().int().positive()).max(LIMITS.productImagesMax).optional(),
  mainImageId: z.number().int().positive().nullable().optional(),
});
export type ProductPatch = z.infer<typeof productPatchSchema>;

export const productReorderSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(5000),
});

export const adminProductsQuerySchema = z.object({
  status: z.enum(['all', 'active', 'hidden']).default('all'),
});

// ---------- Заказы (админ) ----------

export const orderStatusSchema = z.enum(ORDER_STATUSES);

export const orderUpdateSchema = z.object({ status: orderStatusSchema });

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

export const adminOrdersQuerySchema = paginationSchema.extend({
  status: orderStatusSchema.optional(),
  q: z.string().trim().max(100).optional(),
});

export const adminUsersQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
});

export const productsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(40),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

// ---------- Рассылка ----------

export const broadcastCreateSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Введите текст сообщения')
    .max(LIMITS.broadcastTextMax, `Максимум ${LIMITS.broadcastTextMax} символов`),
  withShopButton: z.boolean().default(true),
});
export type BroadcastCreateInput = z.infer<typeof broadcastCreateSchema>;
