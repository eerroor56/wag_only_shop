import {
  keepPreviousData,
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  AdminImageDTO,
  AdminOrderDTO,
  AdminProductDTO,
  AdminProductsDTO,
  AdminUserDTO,
  BroadcastCreateInput,
  BroadcastDTO,
  DashboardDTO,
  MeDTO,
  OrderStatus,
  Paginated,
  ProductFields,
  ProductPatch,
} from '@wag/shared';
import { api, ApiError } from '@wag/web';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

export const keys = {
  me: ['me'] as const,
  dashboard: ['dashboard'] as const,
  products: ['admin-products'] as const,
  product: (id: number) => ['admin-product', id] as const,
  orders: (status: string, q: string) => ['admin-orders', status, q] as const,
  order: (id: number) => ['admin-order', id] as const,
  users: (q: string) => ['admin-users', q] as const,
  broadcasts: ['broadcasts'] as const,
};

const PAGE = 30;

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => api.get<MeDTO>('/api/me'), staleTime: Infinity });
}

export function useDashboard() {
  return useQuery({
    queryKey: keys.dashboard,
    queryFn: () => api.get<DashboardDTO>('/api/admin/dashboard'),
    refetchInterval: 60_000,
  });
}

// ------------------------------------------------------------------ products

export function useAdminProducts() {
  return useQuery({
    queryKey: keys.products,
    queryFn: () => api.get<AdminProductsDTO>('/api/admin/products?status=all'),
  });
}

export function useAdminProduct(id: number | null) {
  return useQuery({
    queryKey: keys.product(id ?? 0),
    queryFn: () => api.get<AdminProductDTO>(`/api/admin/products/${id}`),
    enabled: id != null,
  });
}

export function useSaveProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number | null; data: ProductFields }) =>
      vars.id == null
        ? api.post<AdminProductDTO>('/api/admin/products', vars.data)
        : api.patch<AdminProductDTO>(`/api/admin/products/${vars.id}`, vars.data),
    onSuccess: (product) => {
      qc.setQueryData(keys.product(product.id), product);
      void qc.invalidateQueries({ queryKey: keys.products });
      void qc.invalidateQueries({ queryKey: keys.dashboard });
    },
  });
}

/** Быстрые изменения из списка (скрыть / вернуть в каталог) с оптимистичным обновлением. */
export function usePatchProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number; patch: ProductPatch }) =>
      api.patch<AdminProductDTO>(`/api/admin/products/${vars.id}`, vars.patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: keys.products });
      const previous = qc.getQueryData<AdminProductsDTO>(keys.products);
      if (previous) {
        const items = previous.items.map((p) => (p.id === id ? { ...p, ...patch } as AdminProductDTO : p));
        const active = items.filter((p) => p.isActive).length;
        qc.setQueryData<AdminProductsDTO>(keys.products, {
          items,
          counts: { total: items.length, active, hidden: items.length - active },
        });
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => ctx?.previous && qc.setQueryData(keys.products, ctx.previous),
    onSuccess: (product) => qc.setQueryData(keys.product(product.id), product),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.products });
      void qc.invalidateQueries({ queryKey: keys.dashboard });
    },
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/api/admin/products/${id}`),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: keys.product(id) });
      void qc.invalidateQueries({ queryKey: keys.products });
      void qc.invalidateQueries({ queryKey: keys.dashboard });
    },
  });
}

export function useReorderProducts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => api.put<void>('/api/admin/products/order', { ids }),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: keys.products });
      const previous = qc.getQueryData<AdminProductsDTO>(keys.products);
      if (previous) {
        const byId = new Map(previous.items.map((p) => [p.id, p]));
        qc.setQueryData<AdminProductsDTO>(keys.products, {
          ...previous,
          items: ids.map((id) => byId.get(id)).filter((p): p is AdminProductDTO => Boolean(p)),
        });
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => ctx?.previous && qc.setQueryData(keys.products, ctx.previous),
    onSettled: () => {
      if (qc.isMutating({ mutationKey: ['reorder'] }) <= 1) void qc.invalidateQueries({ queryKey: keys.products });
    },
    mutationKey: ['reorder'],
  });
}

export function uploadImage(file: File): Promise<AdminImageDTO> {
  const form = new FormData();
  form.append('file', file, file.name);
  return api.post<AdminImageDTO>('/api/admin/images', form);
}

// ------------------------------------------------------------------ orders

export function useAdminOrders(status: OrderStatus | 'all', q: string) {
  return useInfiniteQuery({
    queryKey: keys.orders(status, q),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(pageParam) });
      if (status !== 'all') params.set('status', status);
      if (q) params.set('q', q);
      return api.get<Paginated<AdminOrderDTO>>(`/api/admin/orders?${params}`, signal);
    },
    getNextPageParam: (last) => (last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined),
    placeholderData: keepPreviousData,
  });
}

export function useAdminOrder(id: number) {
  return useQuery({
    queryKey: keys.order(id),
    queryFn: () => api.get<AdminOrderDTO>(`/api/admin/orders/${id}`),
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function useUpdateOrderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number; status: OrderStatus }) =>
      api.patch<AdminOrderDTO>(`/api/admin/orders/${vars.id}`, { status: vars.status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: keys.order(id) });
      const previous = qc.getQueryData<AdminOrderDTO>(keys.order(id));
      if (previous) qc.setQueryData(keys.order(id), { ...previous, status });
      return { previous };
    },
    onError: (_e, vars, ctx) => ctx?.previous && qc.setQueryData(keys.order(vars.id), ctx.previous),
    onSuccess: (order) => qc.setQueryData(keys.order(order.id), order),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['admin-orders'] });
      void qc.invalidateQueries({ queryKey: keys.dashboard });
    },
  });
}

// ------------------------------------------------------------------ users

export function useAdminUsers(q: string) {
  return useInfiniteQuery({
    queryKey: keys.users(q),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(pageParam) });
      if (q) params.set('q', q);
      return api.get<Paginated<AdminUserDTO>>(`/api/admin/users?${params}`, signal);
    },
    getNextPageParam: (last) => (last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined),
    placeholderData: keepPreviousData,
  });
}

// ------------------------------------------------------------------ broadcast

export function useBroadcasts() {
  return useQuery({
    queryKey: keys.broadcasts,
    queryFn: () => api.get<{ recipients: number; items: BroadcastDTO[] }>('/api/admin/broadcasts'),
    // Пока рассылка идёт — обновляем прогресс каждые 2 секунды.
    refetchInterval: (query) =>
      query.state.data?.items.some((b) => b.status === 'pending' || b.status === 'running') ? 2000 : false,
  });
}

export function useCreateBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BroadcastCreateInput) => api.post<BroadcastDTO>('/api/admin/broadcasts', input),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.broadcasts }),
  });
}

export function useTestBroadcast() {
  return useMutation({
    mutationFn: (input: BroadcastCreateInput) => api.post<void>('/api/admin/broadcasts/test', input),
  });
}

export function useCancelBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<BroadcastDTO>(`/api/admin/broadcasts/${id}/cancel`),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.broadcasts }),
  });
}
