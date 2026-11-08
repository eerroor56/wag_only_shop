import {
  keepPreviousData,
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  CartDTO,
  CatalogFacetsDTO,
  CategoryDTO,
  CheckoutInput,
  MeDTO,
  OrderDTO,
  ProductDetailDTO,
  ProductsPageDTO,
  PublicConfigDTO,
} from '@wag/shared';
import { api, ApiError } from '@wag/web';
import { catalogApiParams, filtersKey, type CatalogFilters } from '../catalog-filters';

export type { CatalogFilters } from '../catalog-filters';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // 4xx (кроме таймаутов сети) не повторяем
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

export const keys = {
  config: ['config'] as const,
  me: ['me'] as const,
  categories: ['categories'] as const,
  products: (f: CatalogFilters) => ['products', filtersKey(f)] as const,
  productsCount: (f: Partial<CatalogFilters>) => ['products-count', filtersKey(f)] as const,
  facets: (categoryId: number | null) => ['facets', categoryId ?? 'all'] as const,
  search: (q: string) => ['product-search', q] as const,
  product: (id: number) => ['product', id] as const,
  cart: ['cart'] as const,
  order: (id: number) => ['order', id] as const,
};

const CART_MUTATION = ['cart-mutation'];

/** Текущий пользователь; isAdmin определяет сервер по ADMIN_TELEGRAM_IDS. */
export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => api.get<MeDTO>('/api/me'), staleTime: 5 * 60_000 });
}

export function useShopConfig() {
  return useQuery({
    queryKey: keys.config,
    queryFn: () => api.get<PublicConfigDTO>('/api/config'),
    staleTime: Infinity,
  });
}

const PAGE_SIZE = 40;

/** Категории с товарами в продаже — фильтры каталога. */
export function useCategories() {
  return useQuery({
    queryKey: keys.categories,
    queryFn: ({ signal }) => api.get<CategoryDTO[]>('/api/categories', signal),
  });
}

const catalogParams = catalogApiParams;

/** Значения для панели фильтров (бренды, размеры, цвета…) по товарам выбранной категории. */
export function useFacets(categoryId: number | null) {
  return useQuery({
    queryKey: keys.facets(categoryId),
    queryFn: ({ signal }) =>
      api.get<CatalogFacetsDTO>(`/api/products/facets${categoryId != null ? `?categoryId=${categoryId}` : ''}`, signal),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

/** Сколько товаров найдётся с черновиком фильтров — для кнопки «Показать N товаров». */
export function useCatalogCount(filters: Partial<CatalogFilters>, enabled: boolean) {
  return useQuery<number>({
    queryKey: keys.productsCount(filters),
    queryFn: ({ signal }) => api.get<ProductsPageDTO>(`/api/products?${catalogParams(filters, 1)}`, signal).then((p) => p.total),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useCatalog(filters: CatalogFilters) {
  return useInfiniteQuery({
    queryKey: keys.products(filters),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      api.get<ProductsPageDTO>(`/api/products?${catalogParams(filters, PAGE_SIZE, pageParam)}`, signal),
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    // Пока грузятся результаты нового фильтра, на экране остаются прежние — без мигания скелетона.
    placeholderData: keepPreviousData,
  });
}

/** Подсказки поиска: первые совпадения по названию во всём каталоге (закончившиеся — в конце). */
export function useSearchSuggestions(q: string) {
  return useQuery({
    queryKey: keys.search(q),
    queryFn: ({ signal }) => api.get<ProductsPageDTO>(`/api/products?${catalogParams({ q }, 6)}`, signal),
    enabled: q.length > 0,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useProduct(id: number) {
  return useQuery({
    queryKey: keys.product(id),
    queryFn: ({ signal }) => api.get<ProductDetailDTO>(`/api/products/${id}`, signal),
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function useCart() {
  return useQuery({
    queryKey: keys.cart,
    queryFn: ({ signal }) => api.get<CartDTO>('/api/cart', signal),
    staleTime: 10_000,
  });
}

/** Пересчёт итогов корзины локально — только для мгновенного отклика; итоговые цифры всегда приходят с сервера. */
function recalc(cart: CartDTO): CartDTO {
  let totalQuantity = 0;
  let totalAmount = 0;
  const items = cart.items.map((raw) => {
    // Позиция «больше, чем в наличии» становится доступной, как только количество уменьшили до остатка.
    const fits = raw.maxQuantity == null || raw.quantity <= raw.maxQuantity;
    const i =
      raw.maxQuantity != null && (raw.unavailableReason === null || raw.unavailableReason === 'stock')
        ? { ...raw, available: fits, unavailableReason: fits ? null : ('stock' as const) }
        : raw;
    const lineTotal = i.product.price * i.quantity;
    if (i.available) {
      totalQuantity += i.quantity;
      totalAmount += lineTotal;
    }
    return { ...i, lineTotal };
  });
  return { ...cart, items, totalQuantity, totalAmount, hasUnavailable: items.some((i) => !i.available) };
}

function useCartMutationHelpers() {
  const qc = useQueryClient();
  return {
    qc,
    /** Применяем ответ сервера, только если это последняя мутация корзины — иначе ответ устарел. */
    applyServerCart(cart: CartDTO) {
      if (qc.isMutating({ mutationKey: CART_MUTATION }) <= 1) qc.setQueryData(keys.cart, cart);
    },
    settle() {
      if (qc.isMutating({ mutationKey: CART_MUTATION }) <= 1) void qc.invalidateQueries({ queryKey: keys.cart });
    },
  };
}

export function useAddToCart() {
  const { qc, applyServerCart } = useCartMutationHelpers();
  return useMutation({
    mutationKey: CART_MUTATION,
    mutationFn: (vars: { productId: number; quantity?: number; size?: string | null }) =>
      api.post<CartDTO>('/api/cart/items', {
        productId: vars.productId,
        quantity: vars.quantity ?? 1,
        size: vars.size ?? null,
      }),
    onSuccess: applyServerCart,
    onError: () => void qc.invalidateQueries({ queryKey: keys.cart }),
  });
}

export function useUpdateCartItem() {
  const { qc, applyServerCart, settle } = useCartMutationHelpers();
  return useMutation({
    mutationKey: CART_MUTATION,
    mutationFn: (vars: { itemId: number; quantity: number }) =>
      api.patch<CartDTO>(`/api/cart/items/${vars.itemId}`, { quantity: vars.quantity }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: keys.cart });
      const previous = qc.getQueryData<CartDTO>(keys.cart);
      if (previous) {
        qc.setQueryData<CartDTO>(
          keys.cart,
          recalc({
            ...previous,
            items: previous.items.map((i) => (i.id === vars.itemId ? { ...i, quantity: vars.quantity } : i)),
          }),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(keys.cart, context.previous);
    },
    onSuccess: applyServerCart,
    onSettled: settle,
  });
}

export function useRemoveCartItem() {
  const { qc, applyServerCart, settle } = useCartMutationHelpers();
  return useMutation({
    mutationKey: CART_MUTATION,
    mutationFn: (itemId: number) => api.delete<CartDTO>(`/api/cart/items/${itemId}`),
    onMutate: async (itemId) => {
      await qc.cancelQueries({ queryKey: keys.cart });
      const previous = qc.getQueryData<CartDTO>(keys.cart);
      if (previous) {
        qc.setQueryData<CartDTO>(keys.cart, recalc({ ...previous, items: previous.items.filter((i) => i.id !== itemId) }));
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(keys.cart, context.previous);
    },
    onSuccess: applyServerCart,
    onSettled: settle,
  });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CheckoutInput) => api.post<OrderDTO>('/api/orders', input),
    onSuccess: (order) => {
      qc.setQueryData(keys.order(order.id), order);
      qc.setQueryData<CartDTO>(keys.cart, { items: [], totalQuantity: 0, totalAmount: 0, hasUnavailable: false });
      void qc.invalidateQueries({ queryKey: keys.cart });
    },
  });
}

export function useOrder(id: number) {
  return useQuery({
    queryKey: keys.order(id),
    queryFn: ({ signal }) => api.get<OrderDTO>(`/api/orders/${id}`, signal),
    enabled: Number.isInteger(id) && id > 0,
  });
}
