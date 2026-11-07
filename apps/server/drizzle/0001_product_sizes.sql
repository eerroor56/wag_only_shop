ALTER TABLE "cart_items" DROP CONSTRAINT "cart_items_cart_product_uq";--> statement-breakpoint
ALTER TABLE "cart_items" ADD COLUMN "size" varchar(20) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "size_snapshot" varchar(20);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "sizes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_product_size_uq" UNIQUE("cart_id","product_id","size");