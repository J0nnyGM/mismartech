// functions/mercadolibre.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");

const ML_APP_ID = process.env.ML_APP_ID;
const ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET;

// Función auxiliar para hacer peticiones a la API de MercadoLibre
async function fetchML(endpoint, token) {
    const response = await fetch(`https://api.mercadolibre.com${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error(`Error en API ML: ${response.statusText}`);
    return await response.json();
}

/**
 * BUSCADOR INTELIGENTE DE EAN/SKU
 */
async function findProductByEAN(db, eanToFind) {
    if (!eanToFind) return null;
    const ean = String(eanToFind).trim().toUpperCase();
    if (ean === "" || ean === "UNDEFINED" || ean === "NULL") return null;
    
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
// 1. WEBHOOK DE COMPRAS DE MERCADOLIBRE
// ============================================================================
exports.webhook = async (req, res) => {
    const db = admin.firestore();

    try {
        const topic = req.body.topic || req.query.topic;
        const resource = req.body.resource; 
        
        // Responder rápido a ML para que no reintente
        res.status(200).send("OK");

        if (topic !== 'orders_v2' && topic !== 'orders') return;
        if (!resource) return;

        console.log(`📦 Nueva orden de MercadoLibre detectada: ${resource}`);

        // --- LEER EL TOKEN VIGENTE DESDE FIRESTORE ---
        const mlConfigDoc = await db.collection('config').doc('mercadolibre').get();
        if (!mlConfigDoc.exists) throw new Error("Falta configuración de ML en DB");
        const ML_TOKEN = mlConfigDoc.data().accessToken;

        // --- OBTENER DETALLES DE LA ORDEN EN ML ---
        const orderData = await fetchML(resource, ML_TOKEN);
        const orderId = `ML-${orderData.id}`;

        const orderCheck = await db.collection('orders').doc(orderId).get();
        if (orderCheck.exists) {
            const existingOrder = orderCheck.data();
            const newMLStatus = orderData.status;

            if (newMLStatus === 'cancelled' && existingOrder.status !== 'CANCELADO') {
                console.log(`⚠️ Orden de MercadoLibre ${orderId} fue CANCELADA. Revirtiendo stock y estado.`);
                await db.runTransaction(async (t) => {
                    // 1. Devolver Stock
                    for (const item of existingOrder.items || []) {
                        if (item.id && !item.id.includes('UNKNOWN')) {
                            const pRef = db.collection('products').doc(item.id);
                            const pDoc = await t.get(pRef);
                            if (pDoc.exists) {
                                const pData = pDoc.data();
                                let newStock = (pData.stock || 0) + item.quantity;
                                let updatePayload = { stock: newStock, updatedAt: admin.firestore.FieldValue.serverTimestamp() };

                                if (item.color || item.capacity) {
                                    let newCombos = [...(pData.combinations || [])];
                                    const idx = newCombos.findIndex(c => 
                                        (c.color === item.color || (!c.color && !item.color)) &&
                                        (c.capacity === item.capacity || (!c.capacity && !item.capacity))
                                    );
                                    if (idx >= 0) {
                                        newCombos[idx].stock = (newCombos[idx].stock || 0) + item.quantity;
                                        updatePayload.combinations = newCombos;
                                    }
                                }
                                t.update(pRef, updatePayload);
                            }
                        }
                    }

                    // 2. Descontar balance de la cuenta de tesorería (Reverso)
                    if (existingOrder.paymentAccountId) {
                        const accRef = db.collection('accounts').doc(existingOrder.paymentAccountId);
                        const accDoc = await t.get(accRef);
                        if (accDoc.exists) {
                            t.update(accRef, { balance: Math.max(0, (Number(accDoc.data().balance) || 0) - Number(existingOrder.total)) });
                            
                            // Crear un reverso (EXPENSE) de anulación
                            const expenseRef = db.collection('expenses').doc();
                            t.set(expenseRef, {
                                amount: Number(existingOrder.total),
                                category: "Anulación de Venta",
                                description: `Reverso por cancelación de Orden MercadoLibre #${orderData.id}`,
                                paymentMethod: accDoc.data().name, type: 'EXPENSE', orderId: orderId,
                                isRefund: true, date: admin.firestore.FieldValue.serverTimestamp(),
                                createdAt: admin.firestore.FieldValue.serverTimestamp()
                            });
                        }
                    }

                    // 3. Marcar Orden como CANCELADA
                    t.update(db.collection('orders').doc(orderId), {
                        status: 'CANCELADO',
                        paymentStatus: 'CANCELLED',
                        billingStatus: 'CANCELLED',
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        notes: (existingOrder.notes || "") + " [Webhook ML: Orden cancelada por el comprador/plataforma]"
                    });
                });
                console.log(`✅ Stock y estado de la orden ${orderId} revertidos correctamente.`);
            }
            return;
        }

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
                console.log("No se pudo obtener el envío de ML detallado.");
            }
        }

        // --- CREAR O ACTUALIZAR CLIENTE ---
        const buyer = orderData.buyer;
        const buyerDoc = String(buyer.billing_info?.doc_number || buyer.id);
        const buyerPhone = buyer.phone?.number ? `${buyer.phone.area_code || ''} ${buyer.phone.number}`.trim() : "";
        const buyerName = `${buyer.first_name} ${buyer.last_name}`.trim();

        let userId = `ML-${buyer.id}`; 
        
        if (buyerDoc) {
            const userQ = await db.collection('users').where('document', '==', buyerDoc).limit(1).get();
            if (!userQ.empty) {
                userId = userQ.docs[0].id;
            } else {
                const newUserRef = await db.collection('users').add({
                    name: buyerName, document: buyerDoc, phone: buyerPhone, email: buyer.email || "",
                    source: 'MERCADOLIBRE', role: 'client', address: shippingData.address, city: shippingData.city,
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
                id: foundProduct ? foundProduct.docId : `ML-UNKNOWN-${mlEAN}`,
                name: item.item.title,
                price: item.unit_price,
                quantity: qty,
                color: foundProduct ? foundProduct.color : "",
                capacity: foundProduct ? foundProduct.capacity : "",
                sku: mlEAN
            });
        }

        // --- TRANSACCIÓN SEGURA: GUARDAR ORDEN, COBRO Y STOCK ---
        await db.runTransaction(async (t) => {
            const accQ = await t.get(db.collection('accounts').where('name', '==', 'MercadoLibre').limit(1));
            let accId = null, accName = 'MercadoLibre';
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
                    description: `Venta MercadoLibre #${orderData.id}`,
                    paymentMethod: accName, type: 'INCOME', orderId: orderId,
                    supplierName: buyerName, date: admin.firestore.FieldValue.serverTimestamp(),
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }

            const orderRef = db.collection('orders').doc(orderId);
            t.set(orderRef, {
                source: 'MERCADOLIBRE', createdAt: admin.firestore.FieldValue.serverTimestamp(),
                userId: userId, userName: buyerName, phone: buyerPhone, clientDoc: buyerDoc,
                shippingData: shippingData, shippingCarrier: shippingData.carrier, shippingTracking: shippingData.guideNumber,
                shippingId: orderData.shipping && orderData.shipping.id ? String(orderData.shipping.id) : "",
                mlStore: 1,
                items: dbItems, subtotal: orderData.total_amount, shippingCost: 0, total: orderData.total_amount,
                status: shippingData.guideNumber !== 'Pendiente' ? 'DESPACHADO' : 'ALISTADO',
                paymentMethod: 'MERCADOLIBRE', paymentStatus: 'PAID', amountPaid: orderData.total_amount,
                isStockDeducted: true, paymentAccountId: accId
            });
        });

    } catch (error) {
        console.error("❌ Error en Webhook de MercadoLibre:", error);
    }
};

// ============================================================================
// 2. TAREA PROGRAMADA: AUTO-RENOVACIÓN DE TOKEN (CRON JOB)
// ============================================================================
exports.renewTokenTask = async () => {
    const db = admin.firestore();
    const docRef = db.collection('config').doc('mercadolibre');
    
    try {
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
            console.error("❌ Error: No existe el documento config/mercadolibre en Firestore.");
            return;
        }

        const data = docSnap.data();
        const currentRefreshToken = data.refreshToken;

        if (!currentRefreshToken) {
            console.error("❌ Error: No hay refreshToken en la base de datos.");
            return;
        }

        console.log("🔄 Solicitando nuevo token a MercadoLibre...");

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

        if (!response.ok) {
            throw new Error(`Fallo al renovar: ${JSON.stringify(result)}`);
        }

        // Guardamos los nuevos tokens en la base de datos (Sobrescriben a los viejos)
        await docRef.update({
            accessToken: result.access_token,
            refreshToken: result.refresh_token,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log("✅ Token de MercadoLibre renovado y guardado con éxito.");

    } catch (error) {
        console.error("❌ Error Crítico renovando token de ML:", error);
    }
};

// ============================================================================
// 3. OBTENER RÓTULO DE DESPACHO EN PDF
// ============================================================================
exports.getLabel = async (req, res) => {
    const db = admin.firestore();
    
    // Configurar cabeceras CORS básicas
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(204).send('');
    }

    try {
        const shipmentId = req.query.shipmentId || req.query.shipment_id;
        const store = req.query.store || "1"; // "1", "2" o "3"

        if (!shipmentId) {
            return res.status(400).send("Error: Falta el shipmentId en los parámetros.");
        }

        let configDocName = "mercadolibre";
        if (store === "2") configDocName = "mercadolibre_store2";
        else if (store === "3") configDocName = "mercadolibre_store3";

        const mlConfigDoc = await db.collection('config').doc(configDocName).get();
        if (!mlConfigDoc.exists) {
            return res.status(404).send(`Error: No se encontró la configuración para la tienda ${store} en base de datos.`);
        }

        const ML_TOKEN = mlConfigDoc.data().accessToken;
        if (!ML_TOKEN) {
            return res.status(500).send(`Error: Falta el token de acceso para la tienda ${store}.`);
        }

        console.log(`☁️ Descargando etiqueta ML para envío: ${shipmentId} (Tienda ${store})`);

        const mlUrl = `https://api.mercadolibre.com/shipment_labels?shipment_ids=${shipmentId}&savePdf=Y`;
        const mlResponse = await fetch(mlUrl, {
            headers: {
                "Authorization": `Bearer ${ML_TOKEN}`
            }
        });

        if (!mlResponse.ok) {
            const errText = await mlResponse.text();
            console.error("❌ Error de MercadoLibre al descargar etiqueta:", errText);
            return res.status(mlResponse.status).send(`Error de MercadoLibre: ${mlResponse.statusText}`);
        }

        const arrayBuffer = await mlResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="rotulo_ml_${shipmentId}.pdf"`);
        return res.status(200).send(buffer);

    } catch (error) {
        console.error("❌ Error en getLabel:", error);
        return res.status(500).send("Error interno del servidor al obtener el rótulo.");
    }
};