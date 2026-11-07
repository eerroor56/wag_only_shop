import {
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  CartDTO,
  CheckoutInput,
  OrderDTO,
  ProductDetailDTO,
  ProductsPageDTO,
  PublicConfigDTO,
} from '@wag/shared';
import { api, ApiError } from '@wag/web';

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
  products: ['products'] as const,
  product: (id: number) => ['product', id] as const,
  cart: ['cart'] as const,
  order: (id: number) => ['order', id] as const,
};

const CART_MUTATION = ['cart-mutation'];

export function useShopConfig() {
  return useQuery({
    queryKey: keys.config,
    queryFn: () => api.get<PublicConfigDTO>('/api/config'),
    staleTime: Infinity,
  });
}

const PAGE_SIZE = 40;

export function useCatalog() {
  return useInfiniteQuery({
    queryKey: keys.products,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      api.get<ProductsPageDTO>(`/api/products?limit=${PAGE_SIZE}&offset=${pageParam}`, signal),
    getNextPageParam: (last) => last.nextOffset ?? undefined,
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
  const items = cart.items.map((i) => {
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
    mutationFn: (vars: { productId: number; quantity?: number }) =>
      api.post<CartDTO>('/api/cart/items', { productId: vars.productId, quantity: vars.quantity ?? 1 }),
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
