import { db, doc, runTransaction } from "../firebase-init.js";

/**
 * Ajusta el stock de un producto de forma segura (Atómica).
 * Soporta productos simples y productos con Matriz de Variantes, segmentado por sedes.
 * @param {string} productId - ID del producto
 * @param {number} quantityChange - Cantidad a sumar (positivo) o restar (negativo)
 * @param {string|null} variantColor - (Opcional) Color específico
 * @param {string|null} variantCapacity - (Opcional) Capacidad específica
 * @param {string} branchId - (Opcional) ID de la sede a la cual se le ajusta el stock (por defecto 'bodega')
 */
export async function adjustStock(productId, quantityChange, variantColor = null, variantCapacity = null, branchId = 'bodega') {
    const productRef = doc(db, "products", productId);

    try {
        await runTransaction(db, async (transaction) => {
            const productSnap = await transaction.get(productRef);
            if (!productSnap.exists()) throw `El producto ${productId} no existe`;

            const pData = productSnap.data();
            let newStock = 0;
            let newCombinations = pData.combinations || [];
            let newBranchStock = pData.branchStock || {};

            // --- CASO 1: PRODUCTO CON MATRIZ DE VARIANTES ---
            if (pData.combinations && pData.combinations.length > 0) {
                // Buscamos la combinación exacta (Ej: Negro - 128GB)
                const comboIndex = pData.combinations.findIndex(c => 
                    (c.color === variantColor || (!c.color && !variantColor)) &&
                    (c.capacity === variantCapacity || (!c.capacity && !variantCapacity))
                );

                if (comboIndex >= 0) {
                    const combo = pData.combinations[comboIndex];
                    if (!combo.branchStock) combo.branchStock = {};
                    
                    const hasComboBranchStock = Object.keys(combo.branchStock).length > 0;
                    const currentBranchStock = hasComboBranchStock
                        ? (combo.branchStock[branchId] || 0)
                        : (branchId === 'bodega' ? (parseInt(combo.stock) || 0) : 0);
                    const updatedBranchStock = currentBranchStock + quantityChange;

                    if (updatedBranchStock < 0) {
                        throw `Stock insuficiente en esta sede (${branchId}) para la variante: ${pData.name} (${variantColor || ''} ${variantCapacity || ''})`;
                    }

                    // Actualizar el stock de la sede en la combinación
                    combo.branchStock[branchId] = updatedBranchStock;

                    // Recalcular el stock total de esta combinación (suma de todas las sedes)
                    combo.stock = Object.values(combo.branchStock).reduce((sum, val) => sum + val, 0);

                    // Recalcular el stock global del producto sumando todas las combinaciones
                    newStock = pData.combinations.reduce((sum, item) => sum + (item.stock || 0), 0);

                    // Recalcular branchStock de nivel base sumando las combinaciones
                    const rootBranchStock = {};
                    pData.combinations.forEach(c => {
                        if (c.branchStock) {
                            Object.keys(c.branchStock).forEach(bId => {
                                rootBranchStock[bId] = (rootBranchStock[bId] || 0) + (c.branchStock[bId] || 0);
                            });
                        }
                    });
                    newBranchStock = rootBranchStock;
                } else {
                    console.warn(`Variante no encontrada en ${pData.name}, afectando solo global.`);
                    newStock = (pData.stock || 0) + quantityChange;
                    if (newStock < 0) throw `Stock global insuficiente para ${pData.name}`;
                }
            } else {
                // --- CASO 2: PRODUCTO SIMPLE ---
                if (!newBranchStock) newBranchStock = {};
                
                const hasBranchStock = Object.keys(newBranchStock).length > 0;
                const currentBranchStock = hasBranchStock
                    ? (newBranchStock[branchId] || 0)
                    : (branchId === 'bodega' ? (parseInt(pData.stock) || 0) : 0);
                const updatedBranchStock = currentBranchStock + quantityChange;

                if (updatedBranchStock < 0) {
                    throw `Stock insuficiente en esta sede (${branchId}) para ${pData.name}`;
                }

                // Actualizar stock de la sede en el nivel base
                newBranchStock[branchId] = updatedBranchStock;

                // Recalcular el stock global del producto (suma de todas las sedes)
                newStock = Object.values(newBranchStock).reduce((sum, val) => sum + val, 0);
            }

            // Guardamos los cambios de manera segura
            transaction.update(productRef, { 
                stock: newStock,
                branchStock: newBranchStock,
                combinations: newCombinations
            });
        });

        console.log(`✅ Stock actualizado: ${productId} | Sede: ${branchId} | Var: ${variantColor}/${variantCapacity} | Delta: ${quantityChange}`);

    } catch (e) {
        console.error("❌ Error crítico en inventario:", e);
        throw e; // Relanzar para que el llamador sepa que falló
    }
}