// functions/order-counter.js
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

// ============================================================================
// 1. TRIGGER AUTOMÁTICO: ASIGNA CONSECUTIVO A NUEVOS PEDIDOS (V2)
// ============================================================================
exports.assignSequentialNumber = onDocumentCreated("orders/{orderId}", async (event) => {
    // Si no hay datos, no hacemos nada
    const snap = event.data;
    if (!snap) return;

    const orderRef = snap.ref;
    const orderId = event.params.orderId;
    const db = admin.firestore();
    
    // Documento maestro para llevar la cuenta
    const counterRef = db.collection('config').doc('order_counter_master');

    try {
        await db.runTransaction(async (transaction) => {
            const counterDoc = await transaction.get(counterRef);
            
            let nextNumber = 1001; // El primer pedido será el 1001

            if (counterDoc.exists) {
                const currentNumber = counterDoc.data().lastOrderNumber || 1000;
                nextNumber = currentNumber + 1;
            }

            // 1. Actualizamos el contador maestro
            transaction.set(counterRef, { 
                lastOrderNumber: nextNumber,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            // 2. Le inyectamos el consecutivo al pedido
            transaction.update(orderRef, {
                internalOrderNumber: nextNumber
            });
        });

        console.log(`✅ Consecutivo #${nextNumber} asignado al pedido ${orderId}`);
        
    } catch (error) {
        console.error(`❌ Error asignando consecutivo al pedido ${orderId}:`, error);
    }
});


// ============================================================================
// 2. SCRIPT TEMPORAL: ASIGNACIÓN MASIVA AL HISTORIAL (V2)
// ============================================================================
/*exports.backfillOrderNumbers = onRequest(async (req, res) => {
    const db = admin.firestore();
    
    try {
        console.log("Iniciando renombrado masivo de pedidos...");

        // 1. Traer todos los pedidos ordenados del más viejo al más reciente
        const ordersSnapshot = await db.collection('orders').orderBy('createdAt', 'asc').get();
        
        if (ordersSnapshot.empty) {
            res.status(200).send("No hay pedidos en la base de datos para actualizar.");
            return;
        }

        // 2. Variables de control
        let currentNumber = 0; 
        let batches = [];
        let currentBatch = db.batch();
        let operationCounter = 0;
        let totalUpdated = 0;

        // 3. Recorrer todos los pedidos
        ordersSnapshot.docs.forEach((doc) => {
            currentNumber++; // Suma 1
            
            currentBatch.update(doc.ref, { internalOrderNumber: currentNumber });
            
            operationCounter++;
            totalUpdated++;

            // Firebase solo permite 500 operaciones por Batch. Cortamos en 490 por seguridad.
            if (operationCounter === 490) {
                batches.push(currentBatch.commit());
                currentBatch = db.batch(); 
                operationCounter = 0;
            }
        });

        // 4. Actualizar el Contador Maestro
        const counterRef = db.collection('config').doc('order_counter_master');
        currentBatch.set(counterRef, {
            lastOrderNumber: currentNumber,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
        batches.push(currentBatch.commit());

        // 5. Ejecutar todos los bloques en la BD
        await Promise.all(batches);

        console.log(`¡Éxito! ${totalUpdated} pedidos actualizados. Último número: ${currentNumber}`);
        res.status(200).send(`
            <h1>¡Proceso Finalizado con Éxito! ✅</h1>
            <p>Se actualizaron <strong>${totalUpdated}</strong> pedidos antiguos.</p>
            <p>El contador maestro quedó configurado en el número <strong>${currentNumber}</strong>.</p>
            <p style="color: red; font-weight: bold;">⚠️ IMPORTANTE: Ve a tu código, borra esta función (backfillOrderNumbers) y vuelve a hacer deploy por seguridad.</p>
        `);

    } catch (error) {
        console.error("Error en renombrado masivo:", error);
        res.status(500).send("Error crítico actualizando pedidos: " + error.message);
    }
});*/