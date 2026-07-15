const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { adjustProductStockData } = require("./inventory-helper");

exports.createCODOrder = async (data, context) => {
    const db = admin.firestore();
    const auth = admin.auth();

    // --- 1. AUTENTICACIÓN ---
    let uid, email;
    const userToken = data.userToken || (data.data && data.data.userToken);

    try {
        if (context.auth) {
            uid = context.auth.uid;
            email = context.auth.token.email;
        } else if (userToken) {
            const decodedToken = await auth.verifyIdToken(userToken);
            uid = decodedToken.uid;
            email = decodedToken.email;
        } else {
            throw new Error("Sin credenciales.");
        }
    } catch (error) {
        console.error("Auth Error COD:", error);
        throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    // --- 2. DATOS ---
    const rawItems = data.items || (data.data && data.data.items);
    const shippingCost = Number(data.shippingCost || (data.data && data.data.shippingCost) || 0);
    const extraData = data.extraData || (data.data && data.data.extraData) || {};
    const promoCodes = data.promoCodes || (data.data && data.data.promoCodes) || [];
    
    // 🔥 AQUÍ CAPTURAMOS EL MÉTODO ENVIADO DESDE EL shop/checkout.js 🔥
    const paymentMethod = data.paymentMethod || (data.data && data.data.paymentMethod) || 'CONTRAENTREGA';

    if (!rawItems || !rawItems.length) throw new functions.https.HttpsError('invalid-argument', 'Carrito vacío.');

    try {
        const promoValidator = require('./promo-validator');
        // Validar precios reales y cupones en DB para seguridad
        const result = await promoValidator.validateAndApplyDiscounts(rawItems, promoCodes, shippingCost, uid);

        // IDs generados fuera de la transacción para usarlos en escrituras
        const newOrderRef = db.collection('orders').doc();
        // Enlazamos la remisión al ID exacto de la orden
        const remissionRef = db.collection('remissions').doc(newOrderRef.id);
        
        let orderDataToSave = {};
        let remissionDataToSave = {};

        // --- 3. TRANSACCIÓN ATÓMICA ---
        await db.runTransaction(async (t) => {
            const pendingUpdates = []; // Array para guardar las actualizaciones pendientes

            // --- FASE 1: LECTURAS Y CÁLCULOS (Solo .get()) ---
            for (const item of result.dbItems) {
                const pRef = db.collection('products').doc(item.id);
                const pDoc = await t.get(pRef); 
                
                if (!pDoc.exists) throw new Error(`Producto ${item.id} no existe.`);
                
                const pData = pDoc.data();
                const qty = item.quantity;
                
                // Cálculo de Stock y validación
                if (pData.combinations && pData.combinations.length > 0) {
                    const norm = (val) => val ? String(val).trim().toLowerCase() : "";
                    const idx = pData.combinations.findIndex(c => 
                        norm(c.color) === norm(item.color) &&
                        norm(c.capacity) === norm(item.capacity)
                    );
                    if (idx === -1) throw new Error(`Combinación no encontrada para ${pData.name}`);
                    const combo = pData.combinations[idx];
                    const comboBranchStock = combo.branchStock || {};
                    const available = Object.keys(comboBranchStock).length > 0 ? (comboBranchStock['bodega'] || 0) : (parseInt(combo.stock) || 0);
                    if (available < qty) throw new Error(`Sin stock variante: ${pData.name}`);
                } else {
                    const branchStock = pData.branchStock || {};
                    const available = Object.keys(branchStock).length > 0 ? (branchStock['bodega'] || 0) : (parseInt(pData.stock) || 0);
                    if (available < qty) throw new Error(`Sin stock: ${pData.name}`);
                }
                
                // Usar helper para descontar stock
                const updatedStockData = adjustProductStockData(pData, -qty, item.color, item.capacity, 'bodega');

                // Guardar la actualización para la Fase 2 (NO EJECUTAR AÚN)
                pendingUpdates.push({
                    ref: pRef,
                    data: updatedStockData
                });
            }

            // Registrar Uso de Cupones en la misma transacción (NUEVO)
            if (result.appliedPromos && result.appliedPromos.length > 0) {
                await promoValidator.registerPromoUsagesInTransaction(t, result.appliedPromos, uid, newOrderRef.id, extraData.userName || "Cliente");
            }

            // Preparar datos finales de la orden
            const shippingData = extraData.shippingData || {};
            
            orderDataToSave = {
                source: 'TIENDA_WEB', 
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                userId: uid, userEmail: email, userName: extraData.userName || "Cliente",
                phone: extraData.phone || shippingData.phone || "", clientDoc: extraData.clientDoc || "",
                shippingData, billingData: extraData.billingData || null, requiresInvoice: extraData.needsInvoice || false,
                items: result.dbItems, subtotal: result.subtotal, shippingCost: result.finalShippingCost, total: result.totalAmount,
                discountAmount: result.totalDiscounts, appliedPromos: result.appliedPromos,
                appliedPromoCodes: promoCodes.map(c => c.trim().toUpperCase()),
                status: 'PENDIENTE', paymentStatus: 'PENDING', 
                paymentMethod: paymentMethod, 
                isStockDeducted: true,
                buyerInfo: { name: extraData.userName, email, phone: extraData.phone }
            };

            remissionDataToSave = {
                orderId: newOrderRef.id, source: 'TIENDA_WEB',
                clientName: orderDataToSave.userName, clientPhone: orderDataToSave.phone, clientDoc: orderDataToSave.clientDoc,
                clientAddress: `${shippingData.address || ''}, ${shippingData.city || ''}`,
                items: result.dbItems, total: result.totalAmount, status: 'PENDIENTE_ALISTAMIENTO', type: 'VENTA_WEB',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            // --- FASE 2: ESCRITURAS (Solo .update() y .set()) ---
            // 1. Actualizar Stocks
            for (const update of pendingUpdates) {
                t.update(update.ref, update.data);
            }

            // 2. Crear Orden
            t.set(newOrderRef, orderDataToSave);

            // 3. Crear Remisión
            t.set(remissionRef, remissionDataToSave);
        });

        return { orderId: newOrderRef.id };

    } catch (error) {
        console.error("❌ Error COD:", error);
        throw new functions.https.HttpsError('internal', error.message);
    }
};