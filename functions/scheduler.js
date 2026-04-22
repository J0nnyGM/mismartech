const admin = require("firebase-admin");
const db = admin.firestore();

const functions = require("firebase-functions");
const { onSchedule } = require("firebase-functions/v2/scheduler");

/**
 * TAREA PROGRAMADA: EJECUTAR TRANSFERENCIAS AUTOMÁTICAS
 * Se ejecuta todos los días a las 00:05 AM (Hora Colombia)
 */
exports.processScheduledTransfers = onSchedule({
    schedule: "5 0 * * *", 
    timeZone: "America/Bogota"
}, async (event) => {
    
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    console.log("⚙️ Iniciando procesador de transferencias automáticas...");

    try {
        const snapshot = await db.collection('scheduled_transfers')
            .where('status', '==', 'PENDING')
            .where('scheduledDate', '<=', now)
            .get();

        if (snapshot.empty) {
            console.log("✅ No hay transferencias pendientes para hoy.");
            return;
        }

        console.log(`🔄 Procesando ${snapshot.size} transferencias...`);

        const promises = snapshot.docs.map(async (docSnap) => {
            const transfer = docSnap.data();
            const transferId = docSnap.id;

            try {
                await db.runTransaction(async (t) => {
                    const sourceRef = db.collection('accounts').doc(transfer.sourceAccountId);
                    const targetRef = db.collection('accounts').doc(transfer.targetAccountId);
                    
                    const sourceDoc = await t.get(sourceRef);
                    const targetDoc = await t.get(targetRef);

                    if (!sourceDoc.exists || !targetDoc.exists) {
                        throw new Error("Alguna de las cuentas no existe");
                    }

                    const amount = Number(transfer.amount);
                    const newSourceBalance = (Number(sourceDoc.data().balance) || 0) - amount;
                    const newTargetBalance = (Number(targetDoc.data().balance) || 0) + amount;

                    t.update(sourceRef, { balance: newSourceBalance });
                    t.update(targetRef, { balance: newTargetBalance });

                    t.update(db.collection('scheduled_transfers').doc(transferId), {
                        status: 'COMPLETED',
                        executedAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    const outRef = db.collection('expenses').doc();
                    t.set(outRef, {
                        description: transfer.description || "Transferencia Automática",
                        amount: amount,
                        category: "Transferencia Saliente (Auto)",
                        paymentMethod: sourceDoc.data().name, 
                        date: admin.firestore.FieldValue.serverTimestamp(),
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    const inRef = db.collection('expenses').doc();
                    t.set(inRef, {
                        description: transfer.description || "Transferencia Automática",
                        amount: amount,
                        category: "Transferencia Entrante (Auto)",
                        paymentMethod: targetDoc.data().name, 
                        date: admin.firestore.FieldValue.serverTimestamp(),
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                });
                return { success: true, id: transferId };

            } catch (err) {
                console.error(`❌ Error procesando transferencia ${transferId}:`, err);
                await db.collection('scheduled_transfers').doc(transferId).update({
                    status: 'FAILED',
                    error: err.message
                });
                return { success: false, id: transferId };
            }
        });

        await Promise.all(promises);
        console.log("🏁 Procesamiento de transferencias finalizado.");

    } catch (error) {
        console.error("❌ Error General Scheduler:", error);
    }
});

/**
 * LIMPIEZA DE ÓRDENES ANTIGUAS
 * Función desactivada a petición del usuario. Los pedidos cancelados ya NO se borran.
 */
exports.cleanupOldOrders = async (event) => {
    console.log("🛑 Limpieza de órdenes desactivada. Los pedidos cancelados se mantendrán en el historial.");
    return;
};

/**
 * CANCELAR ÓRDENES ABANDONADAS (CADA 30 MINUTOS)
 * - Pasarelas online (PENDIENTE_PAGO): Cancela a las 4 horas.
 * - Transferencia Manual (PENDIENTE): Cancela a las 36 horas.
 */
exports.cancelAbandonedPayments = onSchedule({
    schedule: "every 30 minutes", 
    timeZone: "America/Bogota"
}, async (event) => {
    const db = admin.firestore();
    
    // Tiempo límite para pasarelas online (4 horas)
    const timeout4Hours = new Date();
    timeout4Hours.setHours(timeout4Hours.getHours() - 4);
    const timeoutTimestamp4h = admin.firestore.Timestamp.fromDate(timeout4Hours);

    // Tiempo límite para Transferencia Manual (36 horas)
    const timeout36Hours = new Date();
    timeout36Hours.setHours(timeout36Hours.getHours() - 36);
    const timeoutTimestamp36h = admin.firestore.Timestamp.fromDate(timeout36Hours);

    console.log("⏰ Revisando órdenes abandonadas en 2 fases...");

    try {
        const batch = db.batch();
        let countCanceled = 0;

        // --- FASE 1: Órdenes Online (4 Horas) ---
        const onlineSnapshot = await db.collection('orders')
            .where('status', '==', 'PENDIENTE_PAGO')
            .where('createdAt', '<=', timeoutTimestamp4h)
            .get();

        onlineSnapshot.docs.forEach((doc) => {
            const orderData = doc.data();
            if (orderData.paymentStatus === 'PAID') return;

            batch.update(doc.ref, {
                status: 'CANCELADO',
                statusDetail: 'expired_by_system',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                notes: (orderData.notes || "") + " [Sistema: Cancelado por inactividad de pago online mayor a 4h]"
            });
            countCanceled++;
        });

        // --- FASE 2: Órdenes Manuales (36 Horas) ---
        // La consulta ya trae únicamente los pedidos de hace MÁS de 36 horas.
        const manualSnapshot = await db.collection('orders')
            .where('status', '==', 'PENDIENTE')
            .where('createdAt', '<=', timeoutTimestamp36h)
            .get();

        manualSnapshot.docs.forEach((doc) => {
            const orderData = doc.data();
            
            // Ignoramos si ya está pagada (por precaución)
            if (orderData.paymentStatus === 'PAID') return;

            // CRÍTICO: Proteger pedidos Contra Entrega (COD) para que no se cancelen
            if (orderData.paymentMethod === 'COD' || orderData.paymentMethod === 'CONTRAENTREGA') return;

            // Si es Transferencia Manual y proviene de la TIENDA_WEB, procedemos a cancelar.
            // Eliminamos la validación extra de fechas porque Firestore ya hizo el filtro.
            if (orderData.paymentMethod === 'MANUAL' && orderData.source === 'TIENDA_WEB') {
                batch.update(doc.ref, {
                    status: 'CANCELADO',
                    statusDetail: 'expired_by_system',
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    notes: (orderData.notes || "") + " [Sistema: Cancelado por superar 36h de espera en Transferencia Manual]"
                });
                countCanceled++;
            }
        });

        // --- EJECUTAR CANCELACIONES ---
        if (countCanceled > 0) {
            await batch.commit();
            console.log(`🗑️ Se cancelaron automáticamente ${countCanceled} órdenes abandonadas.`);
        } else {
            console.log(`✅ Revisiones completadas. No hubo órdenes vencidas para cancelar en este ciclo.`);
        }

    } catch (error) {
        console.error("❌ Error en cancelAbandonedPayments:", error);
    }
});

/**
 * VERIFICAR Y DESACTIVAR PROMOCIONES VENCIDAS
 * Se ejecuta cada hora para asegurar que los precios vuelvan a la normalidad.
 */
exports.checkExpiredPromotions = onSchedule({
    schedule: "every 60 minutes", 
    timeZone: "America/Bogota"
}, async (event) => {
    
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    console.log("⏳ Verificando promociones vencidas...");

    try {
        const snapshot = await db.collection('products')
            .where('promoEndsAt', '<=', now)
            .get();

        if (snapshot.empty) {
            console.log("✅ No hay promociones vencidas por desactivar.");
            return;
        }

        const batch = db.batch();
        let count = 0;

        snapshot.docs.forEach((doc) => {
            const p = doc.data();

            if (p.originalPrice && p.originalPrice > 0) {
                batch.update(doc.ref, {
                    price: p.originalPrice, 
                    originalPrice: 0,       
                    promoEndsAt: null       
                });
                count++;
            }
        });

        if (count > 0) {
            await batch.commit();
            console.log(`🏷️ Se desactivaron ${count} ofertas vencidas y se restauraron sus precios.`);
        }

    } catch (error) {
        console.error("❌ Error verificando promociones:", error);
    }
});