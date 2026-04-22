import { db, doc, runTransaction, collection } from './firebase-init.js';

export async function registerPurchase(supplierId, totalCost, items) {
    return await runTransaction(db, async (transaction) => {
        // 1. Actualizar métricas del proveedor
        const suppRef = doc(db, "suppliers", supplierId);
        const suppSnap = await transaction.get(suppRef);
        
        if (!suppSnap.exists()) throw "El proveedor no existe";

        transaction.update(suppRef, {
            totalInvested: (suppSnap.data().totalInvested || 0) + totalCost,
            ordersCount: (suppSnap.data().ordersCount || 0) + 1,
            lastPurchase: new Date()
        });

        // 2. Incrementar stock de cada producto y preparar registro de compra
        for (const item of items) {
            const pRef = doc(db, "products", item.id);
            const pSnap = await transaction.get(pRef);
            
            if (pSnap.exists()) {
                const newStock = (pSnap.data().stock || 0) + item.quantity;
                transaction.update(pRef, { stock: newStock });
            }
        }

        // 3. Crear el recibo histórico de la compra
        const purchaseRef = doc(collection(db, "purchases"));
        transaction.set(purchaseRef, {
            supplierId,
            totalCost,
            items,
            createdAt: new Date()
        });
    });
}