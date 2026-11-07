/**
 * Демо-данные: несколько товаров с галереями. Изображения-заглушки генерируются локально (sharp),
 * поэтому seed работает без доступа к интернету и с любым драйвером хранилища.
 *
 *   npm run db:seed            — добавить демо-товары, если каталог пуст
 *   npm run db:seed -- --force — добавить демо-товары в любом случае
 */
import sharp from 'sharp';
import { count } from 'drizzle-orm';
import { loadConfig } from '../config.js';
import { createStorage } from '../storage/index.js';
import { createDb } from './client.js';
import { productImages, products } from './schema.js';

interface DemoProduct {
  title: string;
  description: string;
  price: number;
  oldPrice?: number;
  discountPercent?: number;
  attributes: { name: string; value: string }[];
  sizes?: string[];
  shades: string[];
}

const rub = (n: number) => n * 100;

const DEMO: DemoProduct[] = [
  {
    title: 'Nike Tech Fleece',
    description:
      'Худи на молнии из фирменного флиса Tech Fleece. Лёгкое, тёплое, с минималистичным силуэтом.\n\nМягкая внутренняя поверхность, карман на молнии на рукаве.',
    price: rub(19_990),
    oldPrice: rub(24_990),
    attributes: [
      { name: 'Бренд', value: 'Nike' },
      { name: 'Материал', value: '66% хлопок, 34% полиэстер' },
      { name: 'Цвет', value: 'Чёрный' },
    ],
    sizes: ['S', 'M', 'L', 'XL'],
    shades: ['#1c1c1e', '#2c2c2e', '#3a3a3c'],
  },
  {
    title: 'Adidas Originals Trefoil',
    description: 'Классический лонгслив Adidas Originals с вышитым логотипом Trefoil. Свободный крой.',
    price: rub(7_490),
    attributes: [
      { name: 'Бренд', value: 'Adidas Originals' },
      { name: 'Материал', value: '100% хлопок' },
    ],
    sizes: ['M/L', 'XL/XXL'],
    shades: ['#e5e5ea', '#d1d1d6', '#c7c7cc'],
  },
  {
    title: 'Stone Island Overshirt',
    description: 'Овершот из плотного хлопка с фирменным съёмным патчем на рукаве. Пуговицы из рога.',
    price: rub(42_000),
    oldPrice: rub(56_000),
    discountPercent: 25,
    attributes: [
      { name: 'Бренд', value: 'Stone Island' },
      { name: 'Страна', value: 'Италия' },
    ],
    sizes: ['46', '48', '50', '52', '54'],
    shades: ['#48484a', '#636366', '#3a3a3c', '#2c2c2e'],
  },
  {
    title: 'The North Face Nuptse 1996',
    description: 'Культовый пуховик в стиле 90-х. Наполнитель — гусиный пух 700 fill power. Капюшон убирается в воротник.',
    price: rub(38_990),
    attributes: [
      { name: 'Бренд', value: 'The North Face' },
      { name: 'Утеплитель', value: 'Пух 700 FP' },
    ],
    sizes: ['48-52', '52/54'],
    shades: ['#0f0f10', '#1c1c1e', '#2c2c2e'],
  },
  {
    title: 'New Balance 990v6',
    description: 'Кроссовки Made in USA. Замша и сетка, амортизация ENCAP.',
    price: rub(27_490),
    oldPrice: rub(31_990),
    attributes: [{ name: 'Бренд', value: 'New Balance' }],
    shades: ['#aeaeb2', '#8e8e93', '#c7c7cc'],
  },
  {
    title: 'Carhartt WIP Chase Hoodie',
    description: 'Худи из мягкого футера с вышитым логотипом.',
    price: rub(11_990),
    attributes: [{ name: 'Бренд', value: 'Carhartt WIP' }],
    shades: ['#3a3a3c', '#48484a'],
  },
];

function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function placeholder(title: string, shade: string, index: number, total: number): Promise<Buffer> {
  const light = parseInt(shade.slice(1, 3), 16) > 0x90;
  const fg = light ? '#000000' : '#ffffff';
  // Длинные названия уменьшаем, чтобы они помещались в кадр 3:4.
  const fontSize = Math.min(64, Math.floor(1700 / Math.max(title.length, 1)));
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500" viewBox="0 0 1200 1500">
    <rect width="1200" height="1500" fill="${shade}"/>
    <rect x="60" y="60" width="1080" height="1380" fill="none" stroke="${fg}" stroke-opacity="0.15" stroke-width="2"/>
    <text x="600" y="700" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="${fg}" letter-spacing="4">${escapeXml(title.toUpperCase())}</text>
    <text x="600" y="790" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="32" fill="${fg}" fill-opacity="0.6" letter-spacing="10">WAG SHOP</text>
    <text x="600" y="1380" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="${fg}" fill-opacity="0.45">${index + 1} / ${total}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  const config = loadConfig();
  const force = process.argv.includes('--force');
  const handle = createDb(config.databaseUrl);
  const storage = await createStorage(config.storage);
  // Импорт после loadConfig: процессор изображений не зависит от конфигурации.
  const { processProductImage } = await import('../storage/image-processor.js');

  try {
    const [existing] = await handle.db.select({ n: count() }).from(products);
    if ((existing?.n ?? 0) > 0 && !force) {
      console.log(`Каталог уже содержит ${existing!.n} товаров — seed пропущен (используйте --force).`);
      return;
    }

    for (const [i, demo] of DEMO.entries()) {
      const [product] = await handle.db
        .insert(products)
        .values({
          title: demo.title,
          description: demo.description,
          price: demo.price,
          oldPrice: demo.oldPrice ?? null,
          discountPercent: demo.discountPercent ?? null,
          attributes: demo.attributes,
          sizes: demo.sizes ?? [],
          sortOrder: i,
        })
        .returning({ id: products.id });

      for (const [idx, shade] of demo.shades.entries()) {
        const processed = await processProductImage(await placeholder(demo.title, shade, idx, demo.shades.length));
        await storage.put(processed.key, processed.full, 'image/webp');
        await storage.put(processed.thumbKey, processed.thumb, 'image/webp');
        await handle.db.insert(productImages).values({
          productId: product!.id,
          storageKey: processed.key,
          thumbKey: processed.thumbKey,
          width: processed.width,
          height: processed.height,
          sortOrder: idx,
          isMain: idx === 0,
        });
      }
      console.log(`✓ ${demo.title}`);
    }
    console.log('Демо-товары добавлены.');
  } finally {
    await handle.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
