ALTER TABLE "products" ADD COLUMN "stock" jsonb;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "stock_total" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "title_sort" text GENERATED ALWAYS AS (lower(translate(title, 'ЁёАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', 'ееабвгдежзийклмнопрстуфхцчшщъыьэюя'))) STORED;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_stock_total_check" CHECK ("products"."stock_total" IS NULL OR "products"."stock_total" >= 0);