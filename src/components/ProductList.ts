import { Product } from "../types/Product";

export const product1: Product = {
    id: "1",
    name: "Panadol Extra",
    genericName: "Paracetamol, Caffeine",
    category: "Analgesic",
    manufacturer: "GlaxoSmithKline Consumer Nigeria PLC",
    barcode: "5011080138012",
    trackBatches: true,
    trackExpiry: true,
    status: "active",
    variants: [
        {
            id: "v1-1",
            productId: "1",
            strength: "500/65",
            strengthUnit: "mg",
            form: "Tablet",
            packagingUnits: [
                {
                    id: "u1-1",
                    name: "Pack",
                    contains: { quantity: 10, unitId: "u1-2" },
                    costPrice: 500,
                    sellingPrice: 700,
                    isDefault: true
                },
                {
                    id: "u1-2",
                    name: "Sachet",
                    costPrice: 50,
                    sellingPrice: 70,
                    isDefault: false
                }
            ]
        },
        {
            id: "v1-2",
            productId: "1",
            strength: "500/65",
            strengthUnit: "mg",
            form: "Caplet",
            packagingUnits: [
                {
                    id: "u1-3",
                    name: "Pack",
                    costPrice: 550,
                    sellingPrice: 750,
                    isDefault: true
                }
            ]
        }
    ]
};

export const product2: Product = {
    id: "2",
    name: "Emzor Paracetamol",
    genericName: "Paracetamol",
    category: "Analgesic",
    manufacturer: "Emzor Pharmaceutical Industries Ltd",
    barcode: "6151101234567",
    trackBatches: true,
    trackExpiry: true,
    status: "active",
    variants: [
        {
            id: "v2-1",
            productId: "2",
            strength: "500",
            strengthUnit: "mg",
            form: "Tablet",
            packagingUnits: [
                {
                    id: "u2-1",
                    name: "Pack",
                    contains: { quantity: 100, unitId: "u2-2" },
                    costPrice: 1200,
                    sellingPrice: 1500,
                    isDefault: true
                },
                {
                    id: "u2-2",
                    name: "Tablet",
                    costPrice: 12,
                    sellingPrice: 15,
                    isDefault: false
                }
            ]
        },
        {
            id: "v2-2",
            productId: "2",
            strength: "125/5",
            strengthUnit: "mg/5mL",
            form: "Syrup",
            packagingUnits: [
                {
                    id: "u2-3",
                    name: "Bottle",
                    costPrice: 400,
                    sellingPrice: 600,
                    isDefault: true
                }
            ]
        }
    ]
};

export const product3: Product = {
    id: "3",
    name: "Amatem Softgel",
    genericName: "Artemether, Lumefantrine",
    category: "Antimalarial",
    manufacturer: "Elbe Pharma Nigeria Ltd",
    barcode: "6151102345678",
    trackBatches: true,
    trackExpiry: true,
    status: "active",
    variants: [
        {
            id: "v3-1",
            productId: "3",
            strength: "80/480",
            strengthUnit: "mg",
            form: "Capsule",
            packagingUnits: [
                {
                    id: "u3-1",
                    name: "Box",
                    costPrice: 1800,
                    sellingPrice: 2300,
                    isDefault: true
                }
            ]
        },
        {
            id: "v3-2",
            productId: "3",
            strength: "20/120",
            strengthUnit: "mg",
            form: "Capsule",
            packagingUnits: [
                {
                    id: "u3-2",
                    name: "Box",
                    costPrice: 1200,
                    sellingPrice: 1600,
                    isDefault: true
                }
            ]
        }
    ]
};

export const product4: Product = {
    id: "4",
    name: "Lonart DS",
    genericName: "Artemether, Lumefantrine",
    category: "Antimalarial",
    manufacturer: "Greenlife Pharmaceuticals Ltd",
    barcode: "6151103456789",
    trackBatches: true,
    trackExpiry: true,
    status: "active",
    variants: [
        {
            id: "v4-1",
            productId: "4",
            strength: "80/480",
            strengthUnit: "mg",
            form: "Tablet",
            packagingUnits: [
                {
                    id: "u4-1",
                    name: "Box",
                    costPrice: 2000,
                    sellingPrice: 2500,
                    isDefault: true
                }
            ]
        }
    ]
};

export const product5: Product = {
    id: "5",
    name: "Augmentin",
    genericName: "Amoxicillin, Clavulanate Potassium",
    category: "Antibiotic",
    manufacturer: "GlaxoSmithKline Consumer Nigeria PLC",
    barcode: "5011080249022",
    trackBatches: true,
    trackExpiry: true,
    status: "active",
    variants: [
        {
            id: "v5-1",
            productId: "5",
            strength: "625",
            strengthUnit: "mg",
            form: "Tablet",
            packagingUnits: [
                {
                    id: "u5-1",
                    name: "Pack",
                    costPrice: 4500,
                    sellingPrice: 5500,
                    isDefault: true
                }
            ]
        },
        {
            id: "v5-2",
            productId: "5",
            strength: "1",
            strengthUnit: "g",
            form: "Tablet",
            packagingUnits: [
                {
                    id: "u5-2",
                    name: "Pack",
                    costPrice: 6500,
                    sellingPrice: 8000,
                    isDefault: true
                }
            ]
        }
    ]
};

export const product6: Product = {
    id: "6",
    name: "Chemiron Blood Tonic",
    genericName: "Ferrous Gluconate, Vitamin B Complex",
    category: "Supplement",
    manufacturer: "Chemiron Care Limited",
    barcode: "6151104567890",
    trackBatches: false,
    trackExpiry: true,
    status: "active",
    variants: [
        {
            id: "v6-1",
            productId: "6",
            strength: "200",
            strengthUnit: "mL",
            form: "Syrup",
            packagingUnits: [
                {
                    id: "u6-1",
                    name: "Bottle",
                    costPrice: 1500,
                    sellingPrice: 2000,
                    isDefault: true
                }
            ]
        }
    ]
};

export const product7: Product = {
    id: "7",
    name: "Procold",
    genericName: "Paracetamol, Phenylephrine HCl, Chlorpheniramine Maleate",
    category: "Cold and Flu",
    manufacturer: "Orange Drugs Nigeria Ltd",
    barcode: "8992222013456",
    trackBatches: true,
    trackExpiry: true,
    status: "active",
    variants: [
        {
            id: "v7-1",
            productId: "7",
            strength: "500/10/2",
            strengthUnit: "mg",
            form: "Caplet",
            packagingUnits: [
                {
                    id: "u7-1",
                    name: "Sachet",
                    costPrice: 200,
                    sellingPrice: 300,
                    isDefault: true
                }
            ]
        }
    ]
};

export const product8: Product = {
    id: "8",
    name: "Fidson Coflin",
    genericName: "Diphenhydramine HCl, Ammonium Chloride",
    category: "Cough Syrup",
    manufacturer: "Fidson Healthcare PLC",
    barcode: "6151106789012",
    trackBatches: true,
    trackExpiry: true,
    status: "active",
    variants: [
        {
            id: "v8-1",
            productId: "8",
            strength: "100",
            strengthUnit: "mL",
            form: "Syrup",
            packagingUnits: [
                {
                    id: "u8-1",
                    name: "Bottle",
                    costPrice: 800,
                    sellingPrice: 1100,
                    isDefault: true
                }
            ]
        }
    ]
};

export const product9: Product = {
    id: "9",
    name: "Goko Cleanser",
    genericName: "Herbal Extracts",
    category: "Herbal Medicine",
    manufacturer: "Bariats Nigeria Ltd",
    barcode: "6151105678901",
    trackBatches: false,
    trackExpiry: false,
    status: "active",
    variants: [
        {
            id: "v9-1",
            productId: "9",
            strength: "500",
            strengthUnit: "mL",
            form: "Liquid",
            packagingUnits: [
                {
                    id: "u9-1",
                    name: "Bottle",
                    costPrice: 1200,
                    sellingPrice: 1600,
                    isDefault: true
                }
            ]
        }
    ]
};

export const product10: Product = {
    id: "10",
    name: "M&B Paracetamol",
    genericName: "Paracetamol",
    category: "Analgesic",
    manufacturer: "May & Baker Nigeria PLC",
    barcode: "6151107890123",
    trackBatches: true,
    trackExpiry: true,
    status: "active",
    variants: [
        {
            id: "v10-1",
            productId: "10",
            strength: "500",
            strengthUnit: "mg",
            form: "Tablet",
            packagingUnits: [
                {
                    id: "u10-1",
                    name: "Pack",
                    contains: { quantity: 96, unitId: "u10-2" },
                    costPrice: 1000,
                    sellingPrice: 1300,
                    isDefault: true
                },
                {
                    id: "u10-2",
                    name: "Tablet",
                    costPrice: 10,
                    sellingPrice: 15,
                    isDefault: false
                }
            ]
        }
    ]
};