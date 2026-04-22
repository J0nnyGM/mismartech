// functions/mercadolibre2.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");

// Leemos las credenciales de la TIENDA 2
const ML_APP_ID = process.env.ML_APP_ID_2;
const ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET_2;

// Función auxiliar para hacer peticiones a la API de MercadoLibre
async function fetchML(endpoint, token) {
    const response = await fetch(`https://api.mercadolibre.com${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error(`Error en API ML2: ${response.statusText}`);
    return await response.json();
}

/**
 * BUSCADOR INTELIGENTE DE EAN/SKU (Idéntico a la tienda 1)
 */
async function findProductByEAN(db, eanToFind) {
    const ean = String(eanToFind).trim().toUpperCase();
    
    const simpleQuery = await db.collection('products').where('sku', '==', ean).limit(1).get();
    if (!simpleQuery.empty) {
        return { docId: simpleQuery.docs[0].id, isVariant: false };
    }

    const variantsQuery = await db.collection('products').where('hasVariants', '==', true).get();
    for (const doc of variantsQuery.docs) {
        const pData = doc.data();
        if (pData.combinations) {
            const variantIndex = pData.combinations.findIndex(c => String(c.sku).trim().toUpperCase() === ean);
            if (variantIndex >= 0) {
                return { 
                    docId: doc.id, 
                    isVariant: true, 
                    variantIndex: variantIndex,
                    color: pData.combinations[variantIndex].color,
                    capacity: pData.combinations[variantIndex].capacity
                };
            }
        }
    }
    return null;
}

// ============================================================================
// 1. WEBHOOK DE COMPRAS DE MERCADOLIBRE (TIENDA 2)
// ============================================================================
exports.webhook = async (req, res) => {
    const db = admin.firestore();

    try {
        const topic = req.body.topic || req.query.topic;
        const resource = req.body.resource; 
        
        res.status(200).send("OK");

        if (topic !== 'orders_v2' && topic !== 'orders') return;
        if (!resource) return;

        console.log(`📦 Nueva orden de MercadoLibre (TIENDA 2) detectada: ${resource}`);

        // --- LEER EL TOKEN VIGENTE DESDE FIRESTORE (Config de Tienda 2) ---
        const mlConfigDoc = await db.collection('config').doc('mercadolibre_store2').get();
        if (!mlConfigDoc.exists) throw new Error("Falta configuración de ML2 en DB");
        const ML_TOKEN = mlConfigDoc.data().accessToken;

        const orderData = await fetchML(resource, ML_TOKEN);
        // Cambiamos el prefijo para no chocar con la tienda 1
        const orderId = `ML2-${orderData.id}`;

        const orderCheck = await db.collection('orders').doc(orderId).get();
        if (orderCheck.exists) return;

        // --- DATOS DE ENVÍO Y GUÍA ---
        let shippingData = { address: "Acordar con el vendedor", city: "", guideNumber: "", carrier: "" };
        if (orderData.shipping && orderData.shipping.id) {
            try {
                const shipment = await fetchML(`/shipments/${orderData.shipping.id}`, ML_TOKEN);
                const receiver = shipment.receiver_address;
                shippingData = {
                    address: receiver ? `${receiver.street_name} ${receiver.street_number}, ${receiver.neighborhood?.name || ''}` : '',
                    city: receiver ? `${receiver.city?.name}, ${receiver.state?.name}` : '',
                    guideNumber: shipment.tracking_number || "Pendiente",
                    carrier: shipment.tracking_method || "MercadoEnvíos",
                    department: receiver?.state?.name || ""
                };
            } catch (err) {
                console.log("No se pudo obtener el envío de ML2 detallado.");
            }
        }

        // --- CREAR O ACTUALIZAR CLIENTE ---
        const buyer = orderData.buyer;
        const buyerDoc = String(buyer.billing_info?.doc_number || buyer.id);
        const buyerPhone = buyer.phone?.number ? `${buyer.phone.area_code || ''} ${buyer.phone.number}`.trim() : "";
        const buyerName = `${buyer.first_name} ${buyer.last_name}`.trim();

        let userId = `ML2-${buyer.id}`; 
        
        if (buyerDoc) {
            const userQ = await db.collection('users').where('document', '==', buyerDoc).limit(1).get();
            if (!userQ.empty) {
                userId = userQ.docs[0].id;
            } else {
                const newUserRef = await db.collection('users').add({
                    name: buyerName, document: buyerDoc, phone: buyerPhone, email: buyer.email || "",
                    source: 'MERCADOLIBRE_2', role: 'client', address: shippingData.address, city: shippingData.city,
                    dept: shippingData.department, createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
                userId = newUserRef.id;
            }
        }

        // --- ARMAR LOS ITEMS ---
        let dbItems = [];
        let itemsToDeduct = [];
        
        for (const item of orderData.order_items) {
            const mlEAN = item.item.seller_sku; 
            const qty = item.quantity;
            
            const foundProduct = await findProductByEAN(db, mlEAN);

            if (foundProduct) {
                itemsToDeduct.push({ ...foundProduct, qty });
            }

            dbItems.push({
                id: foundProduct ? foundProduct.docId : `ML2-UNKNOWN-${mlEAN}`,
                name: item.item.title,
                price: item.unit_price,
                quantity: qty,
                color: foundProduct ? foundProduct.color : "",
                capacity: foundProduct ? foundProduct.capacity : "",
                sku: mlEAN
            });
        }

        // --- TRANSACCIÓN SEGURA ---
        await db.runTransaction(async (t) => {
            // Buscamos cuenta tesorería (Puedes crear una llamada 'MercadoLibre 2' si quieres llevar la cuenta separada)
            const accQ = await t.get(db.collection('accounts').where('name', '==', 'MercadoLibre 2').limit(1));
            let accId = null, accName = 'MercadoLibre 2';
            
            if (!accQ.empty) {
                const accDoc = accQ.docs[0];
                accId = accDoc.id;
                t.update(accDoc.ref, { balance: (Number(accDoc.data().balance) || 0) + Number(orderData.total_amount) });
            }

            for (const p of itemsToDeduct) {
                const pRef = db.collection('products').doc(p.docId);
                const pDoc = await t.get(pRef);
                if (pDoc.exists) {
                    const pData = pDoc.data();
                    let newStock = Math.max(0, (pData.stock || 0) - p.qty);
                    let updatePayload = { stock: newStock };

                    if (p.isVariant && pData.combinations) {
                        let newCombos = [...pData.combinations];
                        if (newCombos[p.variantIndex]) {
                            newCombos[p.variantIndex].stock = Math.max(0, newCombos[p.variantIndex].stock - p.qty);
                        }
                        updatePayload.combinations = newCombos;
                    }
                    t.update(pRef, updatePayload);
                }
            }

            if (accId) {
                const incomeRef = db.collection('expenses').doc();
                t.set(incomeRef, {
                    amount: Number(orderData.total_amount),
                    category: "Ingreso Ventas Online",
                    description: `Venta MercadoLibre 2 #${orderData.id}`,
                    paymentMethod: accName, type: 'INCOME', orderId: orderId,
                    supplierName: buyerName, date: admin.firestore.FieldValue.serverTimestamp(),
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }

            const orderRef = db.collection('orders').doc(orderId);
            t.set(orderRef, {
                source: 'MERCADOLIBRE_2', createdAt: admin.firestore.FieldValue.serverTimestamp(),
                userId: userId, userName: buyerName, phone: buyerPhone, clientDoc: buyerDoc,
                shippingData: shippingData, shippingCarrier: shippingData.carrier, shippingTracking: shippingData.guideNumber,
                items: dbItems, subtotal: orderData.total_amount, shippingCost: 0, total: orderData.total_amount,
                status: shippingData.guideNumber !== 'Pendiente' ? 'DESPACHADO' : 'ALISTADO',
                paymentMethod: 'MERCADOLIBRE_2', paymentStatus: 'PAID', amountPaid: orderData.total_amount,
                isStockDeducted: true, paymentAccountId: accId
            });
        });

    } catch (error) {
        console.error("❌ Error en Webhook de MercadoLibre 2:", error);
    }
};

// ============================================================================
// 2. CRON JOB: AUTO-RENOVACIÓN DE TOKEN (TIENDA 2)
// ============================================================================
exports.renewTokenTask = async () => {
    const db = admin.firestore();
    const docRef = db.collection('config').doc('mercadolibre_store2');
    
    try {
        const docSnap = await docRef.get();
        if (!docSnap.exists) return;

        const data = docSnap.data();
        const currentRefreshToken = data.refreshToken;
        if (!currentRefreshToken) return;

        console.log("🔄 Solicitando nuevo token a MercadoLibre 2...");

        const response = await fetch("https://api.mercadolibre.com/oauth/token", {
            method: "POST",
            headers: {
                "accept": "application/json",
                "content-type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                client_id: ML_APP_ID,
                client_secret: ML_CLIENT_SECRET,
                refresh_token: currentRefreshToken
            })
        });

        const result = await response.json();
        if (!response.ok) throw new Error(`Fallo al renovar ML2: ${JSON.stringify(result)}`);

        await docRef.update({
            accessToken: result.access_token,
            refreshToken: result.refresh_token,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log("✅ Token de MercadoLibre 2 renovado con éxito.");

    } catch (error) {
        console.error("❌ Error Crítico renovando token de ML2:", error);
    }
};