const admin = require("firebase-admin");

/**
 * Ajusta en memoria los datos de stock de un producto (simple o con variantes)
 * y retorna el payload listo para guardar en Firestore.
 * Mantiene sincronizados: stock (global), branchStock (por sedes) y combinations (variantes).
 *
 * @param {object} pData - Datos actuales del producto (doc.data())
 * @param {number} quantityChange - Delta a aplicar (positivo para sumar, negativo para restar)
 * @param {string|null} variantColor - Color de la variante
 * @param {string|null} variantCapacity - Capacidad de la variante
 * @param {string} branchId - ID de la sede (por defecto 'bodega')
 * @returns {object} Payload con { stock, branchStock, combinations }
 */
function adjustProductStockData(pData, quantityChange, variantColor = null, variantCapacity = null, branchId = 'bodega') {
    let newStock = 0;
    let newCombinations = pData.combinations ? JSON.parse(JSON.stringify(pData.combinations)) : [];
    let newBranchStock = pData.branchStock ? JSON.parse(JSON.stringify(pData.branchStock)) : {};

    const norm = (val) => val ? String(val).trim().toLowerCase() : "";
    const targetColor = norm(variantColor);
    const targetCapacity = norm(variantCapacity);

    // --- CASO 1: PRODUCTO CON MATRIZ DE VARIANTES ---
    if (pData.combinations && pData.combinations.length > 0) {
        const comboIndex = newCombinations.findIndex(c => 
            norm(c.color) === targetColor &&
            norm(c.capacity) === targetCapacity
        );

        if (comboIndex >= 0) {
            const combo = newCombinations[comboIndex];
            if (!combo.branchStock) combo.branchStock = {};
            
            const hasComboBranchStock = Object.keys(combo.branchStock).length > 0;
            const currentBranchStock = hasComboBranchStock
                ? (combo.branchStock[branchId] || 0)
                : (branchId === 'bodega' ? (parseInt(combo.stock) || 0) : 0);
            const updatedBranchStock = currentBranchStock + quantityChange;

            combo.branchStock[branchId] = Math.max(0, updatedBranchStock);
            combo.stock = Object.values(combo.branchStock).reduce((sum, val) => sum + val, 0);

            newStock = newCombinations.reduce((sum, item) => sum + (item.stock || 0), 0);

            const rootBranchStock = {};
            newCombinations.forEach(c => {
                if (c.branchStock) {
                    Object.keys(c.branchStock).forEach(bId => {
                        rootBranchStock[bId] = (rootBranchStock[bId] || 0) + (c.branchStock[bId] || 0);
                    });
                }
            });
            newBranchStock = rootBranchStock;
        } else {
            // Combinación no encontrada, modificamos stock global
            newStock = Math.max(0, (pData.stock || 0) + quantityChange);
        }
    } else {
        // --- CASO 2: PRODUCTO SIMPLE ---
        if (!newBranchStock) newBranchStock = {};
        
        const hasBranchStock = Object.keys(newBranchStock).length > 0;
        const currentBranchStock = hasBranchStock
            ? (newBranchStock[branchId] || 0)
            : (branchId === 'bodega' ? (parseInt(pData.stock) || 0) : 0);
        const updatedBranchStock = currentBranchStock + quantityChange;

        newBranchStock[branchId] = Math.max(0, updatedBranchStock);
        newStock = Object.values(newBranchStock).reduce((sum, val) => sum + val, 0);
    }

    return {
        stock: newStock,
        branchStock: newBranchStock,
        combinations: newCombinations,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
}

module.exports = {
    adjustProductStockData
};
