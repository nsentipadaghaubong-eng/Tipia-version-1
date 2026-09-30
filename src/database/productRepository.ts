import { loadDatabase, type SqliteDatabase } from "./connection";
import type { Product, ProductRow, PackagingUnit, PackagingUnitRow } from "../types/Product";

export const mapProductToRow = (product: Product): ProductRow => {
    return {
        ...product,
        nafdacNumber: product.nafdacNumber ?? "",
        trackBatches: product.trackBatches ? 1 : 0,
        trackExpiry: product.trackExpiry ? 1 : 0,
    };
};

export const mapRowToProduct = (row: ProductRow): Product => {
    return {
        ...row,
        nafdacNumber: row.nafdacNumber ?? "",
        barcode: row.barcode ?? "",
        sku: row.sku ?? "",
        lowStockLevel: row.lowStockLevel ?? 5,
        trackBatches: Boolean(row.trackBatches),
        trackExpiry: Boolean(row.trackExpiry),
        status: row.status ?? "active",
        createdAt: row.createdAt ?? undefined,
        variants: [],
    };
};

export const mapRowToPackagingUnit = (row: PackagingUnitRow): PackagingUnit => {
    return {
        id: row.id,
        name: row.name,
        contains:
            row.containsQuantity !== null && row.containsUnitId !== null
                ? {
                    quantity: row.containsQuantity,
                    unitId: row.containsUnitId,
                }
                : undefined,
        costPrice: row.costPrice ?? undefined,
        sellingPrice: row.sellingPrice ?? undefined,
        isDefault: Boolean(row.isDefault),
    };
};

export const saveProductHierarchy = async (
    db: SqliteDatabase,
    product: Product
) => {
    for (const variant of product.variants ?? []) {
        await db.execute(`
            INSERT INTO variants(
                id, product_id, strength, strength_unit, form
            )
            VALUES(?, ?, ?, ?, ?)
        `, [
            variant.id,
            product.id,
            variant.strength ?? "",
            variant.strengthUnit ?? "",
            variant.form ?? "",
        ]);

        for (let level = 0; level < (variant.packagingUnits ?? []).length; level++) {
            const unit = variant.packagingUnits[level];

            await db.execute(`
        INSERT INTO packaging_units(
            id,
            variant_id,
            name,
            level,
            contains_quantity,
            contains_unit_id,
            cost_price,
            selling_price,
            is_default
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
                unit.id,
                variant.id,
                unit.name,
                level + 1,
                unit.contains?.quantity ?? null,
                unit.contains?.unitId ?? null,
                unit.costPrice ?? null,
                unit.sellingPrice ?? null,
                unit.isDefault ? 1 : 0,
            ]);
        }
    }
};

export const getProducts = async (): Promise<Product[]> => {
    const db = await loadDatabase();

    const productRows = await db.select<ProductRow[]>(`
        SELECT 
            id, name, generic_name AS genericName, category, manufacturer,
            nafdac_number AS nafdacNumber,
            barcode, sku, low_stock_level AS lowStockLevel,
            track_batches AS trackBatches, track_expiry AS trackExpiry, status,
            created_at AS createdAt
        FROM products
        ORDER BY created_at IS NULL, created_at DESC, id DESC
    `);

    const variantRows = await db.select<Array<{
        id: string;
        productId: string;
        strength: string;
        strengthUnit: string;
        form: string;
    }>>(`
        SELECT 
            id, product_id AS productId, strength, strength_unit AS strengthUnit, form
        FROM variants
    `);

    const packagingRows = await db.select<PackagingUnitRow[]>(`
    SELECT
        id,
        variant_id AS variantId,
        name,
        level,
        contains_quantity AS containsQuantity,
        contains_unit_id AS containsUnitId,
        cost_price AS costPrice,
        selling_price AS sellingPrice,
        is_default AS isDefault
    FROM packaging_units
    ORDER BY variant_id, level ASC
`);

    return productRows.map((pRow) => {
        const product = mapRowToProduct(pRow);

        const variants = variantRows
            .filter((v) => v.productId === product.id)
            .map((v) => {
                const packagingUnits = packagingRows
                    .filter((u) => u.variantId === v.id)
                    .map(mapRowToPackagingUnit);

                return {
                    id: v.id,
                    productId: v.productId,
                    strength: v.strength,
                    strengthUnit: v.strengthUnit,
                    form: v.form,
                    packagingUnits,
                };
            });

        return {
            ...product,
            variants,
        };
    });
};

export const insertProductRow = async (
    db: SqliteDatabase,
    product: Product,
    createdAt: string
) => {
    const row = mapProductToRow(product);
    await db.execute(`
        INSERT INTO products(
            id,
            name,
            generic_name,
            category,
            manufacturer,
            nafdac_number,
            barcode,
            sku,
            low_stock_level,
            track_batches,
            track_expiry,
            status,
            created_at
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        row.id,
        row.name,
        row.genericName,
        row.category,
        row.manufacturer,
        row.nafdacNumber,
        row.barcode,
        row.sku,
        row.lowStockLevel,
        row.trackBatches,
        row.trackExpiry,
        row.status,
        createdAt,
    ]);
};

export const updateProductRow = async (db: SqliteDatabase, product: Product) => {
    const row = mapProductToRow(product);
    await db.execute(`
        UPDATE products
        SET
            name = ?,
            generic_name = ?,
            category = ?,
            manufacturer = ?,
            nafdac_number = ?,
            barcode = ?,
            sku = ?,
            low_stock_level = ?,
            track_batches = ?,
            track_expiry = ?,
            status = ?
        WHERE id = ?
    `, [
        row.name,
        row.genericName,
        row.category,
        row.manufacturer,
        row.nafdacNumber,
        row.barcode,
        row.sku,
        row.lowStockLevel,
        row.trackBatches,
        row.trackExpiry,
        row.status,
        row.id,
    ]);
};

export const archiveProductRow = (db: SqliteDatabase, id: string) => db.execute(`
    UPDATE products
    SET status = 'archived'
    WHERE id = ?
`, [id]);

export const getProductActivitySnapshot = async (
    db: SqliteDatabase,
    id: string
): Promise<Product | null> => {
    const productRows = await db.select<ProductRow[]>(`
        SELECT
            id,
            name,
            generic_name AS genericName,
            category,
            manufacturer,
            nafdac_number AS nafdacNumber,
            barcode,
            sku,
            low_stock_level AS lowStockLevel,
            track_batches AS trackBatches,
            track_expiry AS trackExpiry,
            status,
            created_at AS createdAt
        FROM products
        WHERE id = ?
    `, [id]);

    if (productRows.length === 0) return null;

    const variantRows = await db.select<Array<{
        id: string;
        productId: string;
        strength: string | null;
        strengthUnit: string | null;
        form: string | null;
    }>>(`
        SELECT
            id,
            product_id AS productId,
            strength,
            strength_unit AS strengthUnit,
            form
        FROM variants
        WHERE product_id = ?
    `, [id]);

    return {
        ...mapRowToProduct(productRows[0]),
        variants: await Promise.all(variantRows.map(async (variant) => ({
            ...variant,
            strength: variant.strength ?? "",
            strengthUnit: variant.strengthUnit ?? "",
            form: variant.form ?? "",
            packagingUnits: await getPackagingUnitsForVariant(db, variant.id),
        }))),
    };
};

export const selectNonArchivedProductIdsById = (db: SqliteDatabase, id: string) =>
    db.select<Array<{ id: string }>>(
        `SELECT id FROM products WHERE id = ? AND status != 'archived'`,
        [id]
    );

export const selectVariantIdsByProductId = (db: SqliteDatabase, productId: string) =>
    db.select<Array<{ id: string }>>(`
        SELECT id
        FROM variants
        WHERE product_id = ?
    `, [productId]);

export const selectVariantIdByIdAndProductId = (
    db: SqliteDatabase,
    variantId: string,
    productId: string
) => db.select<Array<{ id: string }>>(`
    SELECT id
    FROM variants
    WHERE id = ?
    AND product_id = ?
`, [variantId, productId]);

export const insertVariantRow = async (
    db: SqliteDatabase,
    variant: Product["variants"][number],
    productId: string
) => {
    await db.execute(`
        INSERT INTO variants(
            id,
            product_id,
            strength,
            strength_unit,
            form
        )
        VALUES(?, ?, ?, ?, ?)
    `, [
        variant.id,
        productId,
        variant.strength ?? "",
        variant.strengthUnit ?? "",
        variant.form ?? "",
    ]);
};

export const updateVariantRow = async (
    db: SqliteDatabase,
    variant: Product["variants"][number],
    productId: string
) => {
    await db.execute(`
        UPDATE variants
        SET
            strength = ?,
            strength_unit = ?,
            form = ?
        WHERE id = ?
        AND product_id = ?
    `, [
        variant.strength ?? "",
        variant.strengthUnit ?? "",
        variant.form ?? "",
        variant.id,
        productId,
    ]);
};

export const deleteVariantRow = (db: SqliteDatabase, variantId: string) =>
    db.execute(`
        DELETE FROM variants
        WHERE id = ?
    `, [variantId]);

export const deletePackagingUnitsByVariantId = (db: SqliteDatabase, variantId: string) =>
    db.execute(`
        DELETE FROM packaging_units
        WHERE variant_id = ?
    `, [variantId]);

export const selectPackagingUnitIdsByVariantId = (db: SqliteDatabase, variantId: string) =>
    db.select<Array<{ id: string }>>(`
        SELECT id
        FROM packaging_units
        WHERE variant_id = ?
    `, [variantId]);

export const selectPackagingUnitIdByIdAndVariantId = (
    db: SqliteDatabase,
    packagingUnitId: string,
    variantId: string
) => db.select<Array<{ id: string }>>(`
    SELECT id
    FROM packaging_units
    WHERE id = ?
    AND variant_id = ?
`, [packagingUnitId, variantId]);

export const selectPackagingUnitIdsContainingUnit = (
    db: SqliteDatabase,
    packagingUnitId: string
) => db.select<Array<{ id: string }>>(`
    SELECT id
    FROM packaging_units
    WHERE contains_unit_id = ?
    LIMIT 1
`, [packagingUnitId]);

export const deletePackagingUnitRow = (db: SqliteDatabase, packagingUnitId: string) =>
    db.execute(`
        DELETE FROM packaging_units
        WHERE id = ?
    `, [packagingUnitId]);

export const insertPackagingUnitRow = async (
    db: SqliteDatabase,
    unit: PackagingUnit,
    variantId: string,
    level: number
) => {
    await db.execute(`
        INSERT INTO packaging_units(
            id,
            variant_id,
            name,
            level,
            contains_quantity,
            contains_unit_id,
            cost_price,
            selling_price,
            is_default
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        unit.id,
        variantId,
        unit.name,
        level,
        unit.contains?.quantity ?? null,
        unit.contains?.unitId ?? null,
        unit.costPrice ?? null,
        unit.sellingPrice ?? null,
        unit.isDefault ? 1 : 0,
    ]);
};

export const updatePackagingUnitRow = async (
    db: SqliteDatabase,
    unit: PackagingUnit,
    variantId: string,
    level: number
) => {
    await db.execute(`
        UPDATE packaging_units
        SET
        name = ?,
        level = ?,
        contains_quantity = ?,
        contains_unit_id = ?,
        cost_price = ?,
        selling_price = ?,
        is_default = ?
        WHERE id = ?
        AND variant_id = ?
    `, [
        unit.name,
        level,
        unit.contains?.quantity ?? null,
        unit.contains?.unitId ?? null,
        unit.costPrice ?? null,
        unit.sellingPrice ?? null,
        unit.isDefault ? 1 : 0,
        unit.id,
        variantId,
    ]);
};

export const getPackagingUnitsForVariant = async (
    db: SqliteDatabase,
    variantId: string
): Promise<PackagingUnit[]> => {
    const rows = await db.select<PackagingUnitRow[]>(`
        SELECT
            id,
            variant_id AS variantId,
            name,
            level,
            contains_quantity AS containsQuantity,
            contains_unit_id AS containsUnitId,
            cost_price AS costPrice,
            selling_price AS sellingPrice,
            is_default AS isDefault
        FROM packaging_units
        WHERE variant_id = ?
        ORDER BY level ASC
    `, [variantId]);

    return rows.map(mapRowToPackagingUnit);
};
