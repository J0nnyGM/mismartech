const functions = require("firebase-functions");
const admin = require("firebase-admin");

// Esta función se ejecuta visitando una URL en tu navegador
exports.runFix = functions.https.onRequest(async (req, res) => {
    const db = admin.firestore();
    let updatedCount = 0;
    let skippedCount = 0;

    try {
        console.log("Iniciando corrección de cédulas...");
        
        // 1. Traer TODAS las órdenes (Puedes agregar .where("source", "==", "MANUAL") si solo quieres revisar esas)
        const ordersSnap = await db.collection("orders").get();
        
        let batch = db.batch();
        let batchCount = 0;

        for (const orderDoc of ordersSnap.docs) {
            const data = orderDoc.data();

            // 2. Si la orden NO tiene cédula
            if (!data.clientDoc || data.clientDoc.trim() === "") {
                let cedulaToSet = null;

                // Intento A: Buscar al cliente por su userId
                if (data.userId) {
                    const userSnap = await db.collection("users").doc(data.userId).get();
                    if (userSnap.exists && userSnap.data().document) {
                        cedulaToSet = userSnap.data().document;
                    }
                }

                // Intento B: Si no funcionó por userId, buscar por el número de teléfono
                if (!cedulaToSet && data.phone) {
                    // Limpiamos el teléfono por si acaso
                    const cleanPhone = data.phone.replace(/\D/g, '');
                    const userQuery = await db.collection("users").where("phone", "==", cleanPhone).limit(1).get();
                    
                    if (!userQuery.empty && userQuery.docs[0].data().document) {
                        cedulaToSet = userQuery.docs[0].data().document;
                    }
                }

                // 3. Si logramos encontrar la cédula del cliente, la inyectamos a la orden
                if (cedulaToSet) {
                    const buyerInfo = data.buyerInfo || {};
                    buyerInfo.document = cedulaToSet;

                    batch.update(orderDoc.ref, {
                        clientDoc: cedulaToSet,
                        buyerInfo: buyerInfo,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp() // Para que el Dashboard lo repinte
                    });

                    updatedCount++;
                    batchCount++;

                    // Firebase solo permite 500 escrituras por batch, así que lo enviamos por bloques
                    if (batchCount >= 450) {
                        await batch.commit();
                        batch = db.batch();
                        batchCount = 0;
                    }
                } else {
                    // El cliente existe pero tampoco tiene cédula registrada en su perfil
                    skippedCount++;
                }
            }
        }

        // Enviar el último bloque de escrituras si quedaron algunas pendientes
        if (batchCount > 0) {
            await batch.commit();
        }

        res.status(200).send(`
            <h1>✅ Corrección Finalizada</h1>
            <p><b>Órdenes corregidas exitosamente:</b> ${updatedCount}</p>
            <p><b>Órdenes omitidas (El cliente no tiene cédula registrada):</b> ${skippedCount}</p>
            <p>Ya puedes cerrar esta pestaña.</p>
        `);

    } catch (error) {
        console.error("Error corrigiendo cédulas:", error);
        res.status(500).send("❌ Ocurrió un error: " + error.message);
    }
});