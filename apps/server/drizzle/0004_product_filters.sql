ALTER TABLE "products" ADD COLUMN "brand" varchar(60);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "brand_key" varchar(60);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "color_name" varchar(60);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "colors" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "material_name" varchar(120);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "materials" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "gender" varchar(10);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "seasons" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "products_brand_idx" ON "products" USING btree ("brand_key");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_gender_check" CHECK ("products"."gender" IS NULL OR "products"."gender" IN ('men', 'women', 'unisex'));--> statement-breakpoint
-- Перенос характеристик «Бренд», «Цвет», «Материал» / «Состав» из свободного списка в новые поля:
-- по ним сразу работают фильтры. Перенесённая характеристика убирается из списка, чтобы не дублироваться
-- в карточке. Слишком длинные значения (и бренд с запятой) остаются в характеристиках как были.
WITH attrs AS (
  SELECT
    p.id,
    regexp_replace(btrim(a->>'value'), '\s+', ' ', 'g') AS value,
    lower(translate(btrim(a->>'name'), 'ЁёАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', 'ееабвгдежзийклмнопрстуфхцчшщъыьэюя')) AS name,
    ord
  FROM "products" p, jsonb_array_elements(p.attributes) WITH ORDINALITY AS t(a, ord)
),
picked AS (
  SELECT
    id,
    (array_agg(value ORDER BY ord) FILTER (WHERE name IN ('бренд', 'brand', 'марка') AND length(value) BETWEEN 1 AND 60 AND position(',' IN value) = 0))[1] AS brand,
    (array_agg(value ORDER BY ord) FILTER (WHERE name IN ('цвет', 'color', 'colour') AND length(value) BETWEEN 1 AND 60))[1] AS color,
    (array_agg(value ORDER BY ord) FILTER (WHERE name IN ('материал', 'состав', 'material') AND length(value) BETWEEN 1 AND 120))[1] AS material
  FROM attrs
  GROUP BY id
)
UPDATE "products" p
SET
  brand = picked.brand,
  brand_key = lower(translate(picked.brand, 'ЁёАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', 'ееабвгдежзийклмнопрстуфхцчшщъыьэюя')),
  color_name = picked.color,
  material_name = picked.material,
  attributes = (
    SELECT coalesce(jsonb_agg(a ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(p.attributes) WITH ORDINALITY AS t(a, ord)
    WHERE NOT (
      regexp_replace(btrim(a->>'value'), '\s+', ' ', 'g') IN (
        CASE WHEN lower(translate(btrim(a->>'name'), 'ЁёАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', 'ееабвгдежзийклмнопрстуфхцчшщъыьэюя')) IN ('бренд', 'brand', 'марка') THEN picked.brand END,
        CASE WHEN lower(translate(btrim(a->>'name'), 'ЁёАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', 'ееабвгдежзийклмнопрстуфхцчшщъыьэюя')) IN ('цвет', 'color', 'colour') THEN picked.color END,
        CASE WHEN lower(translate(btrim(a->>'name'), 'ЁёАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', 'ееабвгдежзийклмнопрстуфхцчшщъыьэюя')) IN ('материал', 'состав', 'material') THEN picked.material END
      ) IS TRUE
    )
  )
FROM picked
WHERE picked.id = p.id AND (picked.brand IS NOT NULL OR picked.color IS NOT NULL OR picked.material IS NOT NULL);
