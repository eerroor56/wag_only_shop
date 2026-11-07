import { ArrowLeft, ArrowRight, ImagePlus, Plus, Star, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  effectiveDiscountPercent,
  kopecksToInput,
  LIMITS,
  parseRublesInput,
  productCreateSchema,
  suggestPriceFromDiscount,
  type AdminImageDTO,
  type AdminProductDTO,
  type ProductFields,
} from '@wag/shared';
import {
  ApiError,
  confirmDialog,
  ErrorState,
  errorMessage,
  haptic,
  PriceView,
  Spinner,
  useTelegramBackButton,
  useToast,
} from '@wag/web';
import { uploadImage, useAdminProduct, useDeleteProduct, useSaveProduct } from '../api/queries';
import { PageHeader } from '../components/common';
import { SizesEditor } from '../components/SizesEditor';

interface FormState {
  title: string;
  description: string;
  price: string;
  oldPrice: string;
  discountPercent: string;
  isActive: boolean;
  attributes: { key: number; name: string; value: string }[];
  sizes: string[];
}

interface PendingUpload {
  tempId: number;
  preview: string;
  name: string;
}

type Errors = Record<string, string>;

const EMPTY: FormState = {
  title: '',
  description: '',
  price: '',
  oldPrice: '',
  discountPercent: '',
  isActive: true,
  attributes: [],
  sizes: [],
};

let keySeq = 1;

function fromProduct(p: AdminProductDTO): FormState {
  return {
    title: p.title,
    description: p.description,
    price: kopecksToInput(p.price),
    oldPrice: kopecksToInput(p.oldPrice),
    discountPercent: p.discountPercent != null ? String(p.discountPercent) : '',
    isActive: p.isActive,
    attributes: p.attributes.map((a) => ({ key: keySeq++, ...a })),
    sizes: p.sizes,
  };
}

/** Форма → данные API (копейки) + ошибки разбора чисел. */
function toPayload(
  form: FormState,
  images: AdminImageDTO[],
  mainImageId: number | null,
): { data: ProductFields | null; errors: Errors } {
  const errors: Errors = {};
  const price = parseRublesInput(form.price);
  if (price == null) errors.price = form.price.trim() ? 'Введите цену числом, например 19990' : 'Укажите цену';
  const oldPrice = form.oldPrice.trim() ? parseRublesInput(form.oldPrice) : null;
  if (form.oldPrice.trim() && oldPrice == null) errors.oldPrice = 'Введите цену числом';
  const discount = form.discountPercent.trim() ? Number(form.discountPercent.replace('%', '').trim()) : null;
  if (discount != null && (!Number.isInteger(discount) || discount < 1 || discount > 99)) {
    errors.discountPercent = 'Скидка — целое число от 1 до 99';
  }
  if (Object.keys(errors).length) return { data: null, errors };

  const candidate = {
    title: form.title,
    description: form.description,
    price: price!,
    oldPrice,
    discountPercent: discount,
    isActive: form.isActive,
    attributes: form.attributes
      .map(({ name, value }) => ({ name: name.trim(), value: value.trim() }))
      .filter((a) => a.name || a.value),
    sizes: form.sizes,
    imageIds: images.map((i) => i.id),
    mainImageId: mainImageId ?? images[0]?.id ?? null,
  };
  const parsed = productCreateSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = String(issue.path[0]);
      errors[path] ??= issue.message;
    }
    return { data: null, errors };
  }
  return { data: parsed.data, errors };
}

export function ProductEditorPage() {
  const params = useParams();
  const productId = params.id && params.id !== 'new' ? Number(params.id) : null;
  const navigate = useNavigate();
  const toast = useToast();

  const { data: product, isPending, isError, error, refetch } = useAdminProduct(productId);
  const save = useSaveProduct();
  const remove = useDeleteProduct();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [images, setImages] = useState<AdminImageDTO[]>([]);
  const [mainImageId, setMainImageId] = useState<number | null>(null);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [initialized, setInitialized] = useState(productId == null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (product && !initialized) {
      setForm(fromProduct(product));
      setImages(product.images);
      setMainImageId(product.images.find((i) => i.isMain)?.id ?? null);
      setInitialized(true);
    }
  }, [product, initialized]);

  const goBack = () => navigate('/products');
  useTelegramBackButton(goBack);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  };

  // ------------------------------------------------------------ фото

  const onFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const files = Array.from(fileList);
    const free = LIMITS.productImagesMax - images.length - uploads.length;
    if (free <= 0) {
      toast.error(`Можно загрузить не более ${LIMITS.productImagesMax} фото`);
      return;
    }
    if (files.length > free) toast.info(`Будут загружены первые ${free} фото`);

    const queue = files.slice(0, free).filter((f) => {
      if (!f.type.startsWith('image/')) {
        toast.error(`${f.name}: это не изображение`);
        return false;
      }
      if (f.size > LIMITS.imageMaxBytes) {
        toast.error(`${f.name}: больше ${LIMITS.imageMaxBytes / 1024 / 1024} МБ`);
        return false;
      }
      return true;
    });

    const pending = queue.map((file, i) => ({
      file,
      upload: { tempId: Date.now() + i, preview: URL.createObjectURL(file), name: file.name },
    }));
    setUploads((u) => [...u, ...pending.map((p) => p.upload)]);

    // Не более 3 одновременных загрузок; порядок фото сохраняется как при выборе.
    const results: (AdminImageDTO | null)[] = new Array(pending.length).fill(null);
    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        const index = cursor++;
        const { file, upload } = pending[index]!;
        try {
          results[index] = await uploadImage(file);
        } catch (err) {
          toast.error(`${file.name}: ${errorMessage(err)}`);
        } finally {
          URL.revokeObjectURL(upload.preview);
          setUploads((u) => u.filter((x) => x.tempId !== upload.tempId));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker));
    const uploaded = results.filter((r): r is AdminImageDTO => r !== null);
    if (uploaded.length) {
      setImages((prev) => [...prev, ...uploaded]);
      setMainImageId((m) => m ?? uploaded[0]!.id);
      setErrors((e) => ({ ...e, imageIds: '', mainImageId: '' }));
      haptic.notify('success');
    }
  };

  const moveImage = (index: number, delta: number) => {
    setImages((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    haptic.selection();
  };

  const removeImage = (id: number) => {
    setImages((prev) => {
      const next = prev.filter((i) => i.id !== id);
      if (mainImageId === id) setMainImageId(next[0]?.id ?? null);
      return next;
    });
  };

  // ------------------------------------------------------------ сохранение

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (uploads.length) {
      toast.info('Дождитесь окончания загрузки фото');
      return;
    }
    const { data, errors: found } = toPayload(form, images, mainImageId);
    setErrors(found);
    if (!data) {
      haptic.notify('error');
      toast.error('Проверьте заполнение формы');
      return;
    }
    save.mutate(
      { id: productId, data },
      {
        onSuccess: () => {
          haptic.notify('success');
          toast.success(productId ? 'Изменения сохранены' : 'Товар создан');
          navigate('/products');
        },
        onError: (err) => {
          if (err instanceof ApiError && err.details.length) setErrors(err.fieldErrors());
          toast.error(errorMessage(err));
        },
      },
    );
  };

  const onDelete = async () => {
    if (!productId) return;
    const ok = await confirmDialog(
      `Удалить «${form.title || 'товар'}» навсегда? Оформленные заказы сохранятся. Чтобы временно убрать товар из каталога, используйте «Скрыть».`,
    );
    if (!ok) return;
    remove.mutate(productId, {
      onSuccess: () => {
        toast.success('Товар удалён');
        navigate('/products', { replace: true });
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  const applyDiscount = () => {
    const old = parseRublesInput(form.oldPrice);
    const pct = Number(form.discountPercent);
    if (old == null || !Number.isInteger(pct) || pct < 1 || pct > 99) {
      toast.error('Укажите старую цену и скидку от 1 до 99%');
      return;
    }
    set('price', kopecksToInput(suggestPriceFromDiscount(old, pct)));
  };

  // ------------------------------------------------------------ render

  if (productId != null && isError) {
    return (
      <div className="container">
        <PageHeader title="Товар" onBack={goBack} />
        <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (productId != null && (isPending || !initialized)) {
    return (
      <div className="page-loader">
        <Spinner />
      </div>
    );
  }

  const preview = (() => {
    const price = parseRublesInput(form.price);
    if (price == null) return null;
    const oldPrice = form.oldPrice.trim() ? parseRublesInput(form.oldPrice) : null;
    const discount = form.discountPercent.trim() ? Number(form.discountPercent) : null;
    const valid = oldPrice != null && oldPrice > price;
    return {
      price,
      oldPrice: valid ? oldPrice : null,
      discountPercent: valid
        ? effectiveDiscountPercent({ price, oldPrice, discountPercent: Number.isInteger(discount) ? discount : null })
        : null,
    };
  })();

  const busy = save.isPending || remove.isPending;

  return (
    <div className="container editor">
      <PageHeader title={productId ? 'Редактирование' : 'Новый товар'} onBack={goBack} />

      <form onSubmit={onSubmit} noValidate className="editor-form">
        {/* --------------------------------------------------- Название */}
        <label className="field">
          <span className="field-label">Название</span>
          <input
            className="input"
            placeholder="Например, Nike Tech Fleece"
            maxLength={LIMITS.productTitleMax}
            value={form.title}
            aria-invalid={Boolean(errors.title)}
            onChange={(e) => set('title', e.target.value)}
          />
          {errors.title && <span className="field-error">{errors.title}</span>}
        </label>

        {/* --------------------------------------------------- Фото */}
        <section className="field">
          <span className="field-label">
            Фотографии · {images.length}/{LIMITS.productImagesMax}
          </span>
          <div className="photo-grid">
            {images.map((img, i) => {
              const isMain = (mainImageId ?? images[0]?.id) === img.id;
              return (
                <div className={`photo ${isMain ? 'is-main' : ''}`} key={img.id}>
                  <img src={img.thumbUrl} alt={`Фото ${i + 1}`} />
                  {isMain && <span className="photo-main-label">Главное</span>}
                  <button
                    type="button"
                    className="photo-remove"
                    aria-label="Удалить фото"
                    onClick={() => removeImage(img.id)}
                  >
                    <X size={14} strokeWidth={2.4} />
                  </button>
                  <div className="photo-actions">
                    <button type="button" aria-label="Сдвинуть влево" disabled={i === 0} onClick={() => moveImage(i, -1)}>
                      <ArrowLeft size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label="Сделать главным"
                      aria-pressed={isMain}
                      onClick={() => {
                        setMainImageId(img.id);
                        haptic.selection();
                      }}
                    >
                      <Star size={14} fill={isMain ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      type="button"
                      aria-label="Сдвинуть вправо"
                      disabled={i === images.length - 1}
                      onClick={() => moveImage(i, 1)}
                    >
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
            {uploads.map((u) => (
              <div className="photo is-uploading" key={u.tempId}>
                <img src={u.preview} alt={u.name} />
                <div className="photo-overlay">
                  <Spinner size={22} />
                </div>
              </div>
            ))}
            {images.length + uploads.length < LIMITS.productImagesMax && (
              <button type="button" className="photo-add" onClick={() => fileInput.current?.click()}>
                <ImagePlus size={22} strokeWidth={1.6} />
                <span>Добавить</span>
              </button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void onFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <span className="field-hint">
            JPEG, PNG, WebP до 10 МБ. ★ — главное фото (обложка в каталоге), стрелки меняют порядок в галерее.
          </span>
          {(errors.imageIds || errors.mainImageId) && (
            <span className="field-error">{errors.imageIds || errors.mainImageId}</span>
          )}
        </section>

        {/* --------------------------------------------------- Цены */}
        <section className="card editor-card">
          <div className="field-row">
            <label className="field">
              <span className="field-label">Старая цена, ₽</span>
              <input
                className="input"
                inputMode="decimal"
                placeholder="24 990"
                value={form.oldPrice}
                aria-invalid={Boolean(errors.oldPrice)}
                onChange={(e) => set('oldPrice', e.target.value)}
              />
            </label>
            <label className="field field-narrow">
              <span className="field-label">Скидка, %</span>
              <input
                className="input"
                inputMode="numeric"
                placeholder="авто"
                value={form.discountPercent}
                aria-invalid={Boolean(errors.discountPercent)}
                onChange={(e) => set('discountPercent', e.target.value.replace(/[^\d]/g, '').slice(0, 2))}
              />
            </label>
          </div>
          {(errors.oldPrice || errors.discountPercent) && (
            <span className="field-error">{errors.oldPrice || errors.discountPercent}</span>
          )}

          <label className="field">
            <span className="field-label">{form.oldPrice ? 'Цена со скидкой, ₽' : 'Цена, ₽'}</span>
            <input
              className="input"
              inputMode="decimal"
              placeholder="19 990"
              value={form.price}
              aria-invalid={Boolean(errors.price)}
              onChange={(e) => set('price', e.target.value)}
            />
            {errors.price && <span className="field-error">{errors.price}</span>}
          </label>

          {form.oldPrice && form.discountPercent && (
            <button type="button" className="btn btn-outline btn-sm" onClick={applyDiscount}>
              Рассчитать цену со скидкой {form.discountPercent}%
            </button>
          )}

          <p className="field-hint">
            Покупатель платит «цену со скидкой» — её всегда задаёте вы. Если процент не указан, он рассчитается
            автоматически из старой цены.
          </p>

          {preview && (
            <div className="price-preview">
              <span className="caption">Так увидит покупатель:</span>
              <PriceView {...preview} size="md" />
            </div>
          )}
        </section>

        {/* --------------------------------------------------- Размеры */}
        <SizesEditor value={form.sizes} onChange={(sizes) => set('sizes', sizes)} error={errors.sizes} />

        {/* --------------------------------------------------- Описание */}
        <label className="field">
          <span className="field-label">Описание</span>
          <textarea
            className="textarea"
            rows={6}
            placeholder="Материал, посадка, особенности…"
            maxLength={LIMITS.productDescriptionMax}
            value={form.description}
            aria-invalid={Boolean(errors.description)}
            onChange={(e) => set('description', e.target.value)}
          />
          <span className="field-hint">
            {form.description.length}/{LIMITS.productDescriptionMax}
          </span>
          {errors.description && <span className="field-error">{errors.description}</span>}
        </label>

        {/* --------------------------------------------------- Характеристики */}
        <section className="field">
          <span className="field-label">Характеристики</span>
          {form.attributes.map((a, i) => (
            <div className="attr-row" key={a.key}>
              <input
                className="input"
                placeholder="Бренд"
                maxLength={LIMITS.productAttributeNameMax}
                value={a.name}
                onChange={(e) =>
                  set(
                    'attributes',
                    form.attributes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                  )
                }
              />
              <input
                className="input"
                placeholder="Nike"
                maxLength={LIMITS.productAttributeValueMax}
                value={a.value}
                onChange={(e) =>
                  set(
                    'attributes',
                    form.attributes.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                  )
                }
              />
              <button
                type="button"
                className="icon-btn icon-btn-plain"
                aria-label="Удалить характеристику"
                onClick={() => set('attributes', form.attributes.filter((_, j) => j !== i))}
              >
                <X size={16} />
              </button>
            </div>
          ))}
          {form.attributes.length < LIMITS.productAttributesMax && (
            <button
              type="button"
              className="btn btn-ghost btn-sm align-start"
              onClick={() => set('attributes', [...form.attributes, { key: keySeq++, name: '', value: '' }])}
            >
              <Plus size={15} /> Добавить характеристику
            </button>
          )}
          {errors.attributes && <span className="field-error">{errors.attributes}</span>}
        </section>

        {/* --------------------------------------------------- Видимость */}
        <label className="switch-row card">
          <span>
            <span className="switch-title">Показывать в каталоге</span>
            <span className="caption">Скрытый товар не виден покупателям, заказы с ним сохраняются</span>
          </span>
          <input
            type="checkbox"
            className="switch"
            checked={form.isActive}
            onChange={(e) => set('isActive', e.target.checked)}
          />
        </label>

        <div className="editor-actions">
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || uploads.length > 0}>
            {save.isPending ? <Spinner size={18} /> : productId ? 'Сохранить изменения' : 'Создать товар'}
          </button>
          {productId != null && (
            <button type="button" className="btn btn-danger btn-block" onClick={onDelete} disabled={busy}>
              <Trash2 size={16} /> Удалить товар
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
